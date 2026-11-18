import { getDatabase } from "@netlify/database";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getStore } from "@netlify/blobs";

const cookieName = "cp_session";
const json = (statusCode, data, extra={}) => ({
  statusCode,
  headers: { "Content-Type":"application/json", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", ...extra },
  body: JSON.stringify(data)
});
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  return new TextEncoder().encode(s);
};
const parseCookies = (header="") => Object.fromEntries(header.split(";").map(v=>v.trim()).filter(Boolean).map(v=>{
  const i=v.indexOf("="); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))];
}));
const issueCookie = token => `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
async function currentUser(event) {
  const token = parseCookies(event.headers.cookie || event.headers.Cookie || "")[cookieName];
  if (!token) return null;
  try {
    const {payload}=await jwtVerify(token,secret(),{issuer:"careerpilot",audience:"careerpilot-web"});
    return {id:payload.sub,email:payload.email,role:payload.role};
  } catch { return null; }
}
async function makeToken(user) {
  return new SignJWT({email:user.email,role:user.role})
    .setProtectedHeader({alg:"HS256"}).setSubject(user.id)
    .setIssuer("careerpilot").setAudience("careerpilot-web")
    .setIssuedAt().setExpirationTime("7d").sign(secret());
}
const bodyOf = event => { try{return event.body?JSON.parse(event.body):{}}catch{return null} };

async function legacyHandler(event) {
  if (event.httpMethod==="OPTIONS") return {statusCode:204,headers:{"Access-Control-Allow-Origin":event.headers.origin||"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,PATCH,DELETE,OPTIONS"},body:""};
  const path=(event.path||"").replace(/^.*\/api\/?/,"").replace(/^\/+|\/+$/g,"");
  const method=event.httpMethod;
  const body=bodyOf(event);
  if(body===null) return json(400,{error:"Invalid JSON."});
  try {
    const db=await getDatabase();

    if(path==="health" && method==="GET") {
      const rows=await db.sql`SELECT now() AS database_time`;
      return json(200,{ok:true,database:"connected",time:rows[0].database_time});
    }

    if(path==="auth/register" && method==="POST") {
      const email=String(body.email||"").trim().toLowerCase();
      const password=String(body.password||"");
      const fullName=String(body.full_name||"").trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400,{error:"Enter a valid email address."});
      if(password.length<10) return json(400,{error:"Use a password with at least 10 characters."});
      if(!fullName) return json(400,{error:"Full name is required."});
      const hash=await bcrypt.hash(password,12);
      const rows=await db.sql`INSERT INTO users(email,password_hash,role) VALUES(${email},${hash},'student') RETURNING id,email,role`;
      const user=rows[0];
      await db.sql`INSERT INTO student_profiles(user_id,full_name) VALUES(${user.id},${fullName})`;
      const token=await makeToken(user);
      return json(201,{user:{id:user.id,email:user.email,role:user.role}},{"Set-Cookie":issueCookie(token)});
    }

    if(path==="auth/login" && method==="POST") {
      const email=String(body.email||"").trim().toLowerCase();
      const rows=await db.sql`SELECT id,email,password_hash,role FROM users WHERE email=${email} LIMIT 1`;
      if(!rows.length || !(await bcrypt.compare(String(body.password||""),rows[0].password_hash))) return json(401,{error:"Email or password is incorrect."});
      const user=rows[0], token=await makeToken(user);
      return json(200,{user:{id:user.id,email:user.email,role:user.role}},{"Set-Cookie":issueCookie(token)});
    }

    if(path==="auth/logout" && method==="POST") return json(200,{ok:true},{"Set-Cookie":clearCookie});

    const user=await currentUser(event);
    if(!user) return json(401,{error:"Please sign in again."});
    if(path==="auth/me" && method==="GET") return json(200,{user});
    if(path==="me" && method==="GET") {
      const rows=await db.sql`SELECT * FROM student_profiles WHERE user_id=${user.id}`;
      return json(200,{profile:rows[0]||null});
    }

    if(path==="profile" && (method==="GET"||method==="PATCH")) {
      if(user.role!=="student") return json(403,{error:"Student account required."});
      if(method==="GET") {
        const rows=await db.sql`SELECT user_id,full_name,phone,location,college,degree,academic_year,cgpa,target_role,skills,about,resume_blob_key FROM student_profiles WHERE user_id=${user.id}`;
        return json(200,{profile:rows[0]||null});
      }
      const b=body;
      const rows=await db.sql`INSERT INTO student_profiles(user_id,full_name,phone,location,college,degree,academic_year,cgpa,target_role,skills,about,updated_at)
        VALUES(${user.id},${String(b.full_name||"")},${b.phone||null},${b.location||null},${b.college||null},${b.degree||null},${b.academic_year||null},${b.cgpa??null},${b.target_role||null},${JSON.stringify(Array.isArray(b.skills)?b.skills:[]) }::jsonb,${b.about||null},now())
        ON CONFLICT(user_id) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,location=EXCLUDED.location,college=EXCLUDED.college,degree=EXCLUDED.degree,academic_year=EXCLUDED.academic_year,cgpa=EXCLUDED.cgpa,target_role=EXCLUDED.target_role,skills=EXCLUDED.skills,about=EXCLUDED.about,updated_at=now()
        RETURNING *`;
      return json(200,{profile:rows[0]});
    }

    if(path==="opportunities" && method==="GET") {
      const q=String(event.queryStringParameters?.q||"").trim();
      const rows=q
        ? await db.sql`SELECT id,title,company_name,location,work_mode,employment_type,stipend,description,required_skills,deadline,verified,created_at FROM opportunities WHERE status='published' AND (title ILIKE ${"%"+q+"%"} OR company_name ILIKE ${"%"+q+"%"}) ORDER BY created_at DESC LIMIT 100`
        : await db.sql`SELECT id,title,company_name,location,work_mode,employment_type,stipend,description,required_skills,deadline,verified,created_at FROM opportunities WHERE status='published' ORDER BY created_at DESC LIMIT 100`;
      return json(200,{opportunities:rows});
    }

    if(path==="applications" && method==="GET") {
      const rows=await db.sql`SELECT a.id,a.opportunity_id,a.status,a.created_at,a.updated_at,o.title,o.company_name FROM applications a JOIN opportunities o ON o.id=a.opportunity_id WHERE a.student_id=${user.id} ORDER BY a.created_at DESC`;
      return json(200,{applications:rows.map(r=>({...r,opportunities:{title:r.title,company_name:r.company_name}}))});
    }
    if(path==="applications" && method==="POST") {
      if(!body.opportunity_id) return json(400,{error:"Opportunity is required."});
      const rows=await db.sql`INSERT INTO applications(student_id,opportunity_id,cover_note) SELECT ${user.id},id,${body.cover_note||null} FROM opportunities WHERE id=${body.opportunity_id} AND status='published' ON CONFLICT(student_id,opportunity_id) DO NOTHING RETURNING *`;
      if(!rows.length) return json(409,{error:"You have already applied, or this opportunity is unavailable."});
      return json(201,{application:rows[0]});
    }
    if(path==="saved" && method==="GET") {
      const rows=await db.sql`SELECT s.opportunity_id,s.created_at,o.title,o.company_name,o.location,o.employment_type,o.work_mode,o.stipend,o.deadline,o.verified FROM saved_opportunities s JOIN opportunities o ON o.id=s.opportunity_id WHERE s.student_id=${user.id} ORDER BY s.created_at DESC`;
      return json(200,{saved:rows});
    }
    if(path==="saved" && method==="POST") {
      if(!body.opportunity_id) return json(400,{error:"Opportunity is required."});
      const rows=await db.sql`INSERT INTO saved_opportunities(student_id,opportunity_id) VALUES(${user.id},${body.opportunity_id}) ON CONFLICT DO NOTHING RETURNING *`;
      return json(200,{saved:rows[0]||{opportunity_id:body.opportunity_id}});
    }
    if(path.startsWith("saved/") && method==="DELETE") {
      const id=path.split("/")[1];
      await db.sql`DELETE FROM saved_opportunities WHERE student_id=${user.id} AND opportunity_id=${id}`;
      return json(200,{ok:true});
    }
    if(path==="resume" && method==="GET") {
      const rows=await db.sql`SELECT resume_blob_key,resume_file_name,resume_content_type,resume_size,resume_uploaded_at FROM student_profiles WHERE user_id=${user.id}`;
      const r=rows[0]||{};
      return json(200,{resume:r.resume_blob_key?{file_name:r.resume_file_name,content_type:r.resume_content_type,size:r.resume_size,uploaded_at:r.resume_uploaded_at}:null});
    }

    if(path==="resume/upload" && method==="POST") {
      const filename=String(body.file_name||"").replace(/[\\/\r\n"]/g,"_").slice(0,180);
      const contentType=String(body.content_type||"").toLowerCase();
      const encoded=String(body.file_base64||"");
      if(!filename || !encoded) return json(400,{error:"Choose a resume file first."});
      const ext=filename.toLowerCase().split(".").pop();
      if(!["pdf","docx"].includes(ext)) return json(400,{error:"Only PDF and DOCX files are supported."});
      const expectedType=ext==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if(contentType!==expectedType) return json(400,{error:"The file type does not match the selected extension."});
      if(encoded.length>Math.ceil(4*1024*1024*4/3)+16) return json(413,{error:"Resume must be 4 MB or smaller."});
      const bytes=Buffer.from(encoded,"base64");
      if(bytes.length===0 || bytes.length>4*1024*1024) return json(413,{error:"Resume must be between 1 byte and 4 MB."});
      const signatureOk=ext==="pdf"
        ? bytes.subarray(0,5).toString("ascii")==="%PDF-"
        : bytes.length>4 && bytes[0]===0x50 && bytes[1]===0x4b && [0x03,0x05,0x07].includes(bytes[2]) && [0x04,0x06,0x08].includes(bytes[3]);
      if(!signatureOk) return json(400,{error:"The uploaded file does not appear to be a valid PDF or DOCX document."});
      const key=`${user.id}/resume`;
      const store=getStore("careerpilot-private-resumes");
      const arrayBuffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      await store.set(key,arrayBuffer,{metadata:{owner_id:user.id,file_name:filename,content_type:expectedType,size:bytes.length,uploaded_at:new Date().toISOString()}});
      const rows=await db.sql`UPDATE student_profiles SET resume_blob_key=${key},resume_file_name=${filename},resume_content_type=${expectedType},resume_size=${bytes.length},resume_uploaded_at=now(),updated_at=now() WHERE user_id=${user.id} RETURNING resume_file_name,resume_content_type,resume_size,resume_uploaded_at`;
      return json(200,{resume:{file_name:rows[0]?.resume_file_name||filename,content_type:expectedType,size:bytes.length,uploaded_at:rows[0]?.resume_uploaded_at||new Date().toISOString()}});
    }

    if(path==="resume/download" && method==="GET") {
      const rows=await db.sql`SELECT resume_blob_key,resume_file_name,resume_content_type FROM student_profiles WHERE user_id=${user.id}`;
      const r=rows[0];
      if(!r?.resume_blob_key) return json(404,{error:"No resume is uploaded."});
      if(r.resume_blob_key!==`${user.id}/resume`) return json(403,{error:"Resume ownership check failed."});
      const blob=await getStore("careerpilot-private-resumes").get(r.resume_blob_key,{type:"arrayBuffer"});
      if(!blob) return json(404,{error:"Resume file was not found in private storage."});
      return {
        statusCode:200,
        headers:{
          "Content-Type":r.resume_content_type||"application/octet-stream",
          "Content-Disposition":`attachment; filename="${String(r.resume_file_name||"resume").replace(/["\r\n]/g,"_")}"`,
          "Cache-Control":"private, no-store",
          "X-Content-Type-Options":"nosniff"
        },
        body:Buffer.from(blob).toString("base64"),
        isBase64Encoded:true
      };
    }

    if(path==="resume" && method==="DELETE") {
      const rows=await db.sql`SELECT resume_blob_key FROM student_profiles WHERE user_id=${user.id}`;
      const key=rows[0]?.resume_blob_key;
      if(key) {
        if(key!==`${user.id}/resume`) return json(403,{error:"Resume ownership check failed."});
        await getStore("careerpilot-private-resumes").delete(key);
      }
      await db.sql`UPDATE student_profiles SET resume_blob_key=NULL,resume_file_name=NULL,resume_content_type=NULL,resume_size=NULL,resume_uploaded_at=NULL,updated_at=now() WHERE user_id=${user.id}`;
      return json(200,{ok:true});
    }

    if(path==="notifications" && method==="GET") {
      const rows=await db.sql`SELECT id,title,body,read_at,created_at FROM notifications WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 50`;
      return json(200,{notifications:rows});
    }
    return json(404,{error:"API route not found."});
  } catch(err) {
    console.error("CareerPilot API:",err);
    const msg=String(err.message||"");
    if(msg.includes("duplicate key")) return json(409,{error:"An account with this email already exists."});
    return json(500,{error:"The request could not be completed. Check the Netlify Function logs."});
  }
}

// Netlify's modern ESM function signature receives a Web Request and returns a Response.
// Adapt it to the event-shaped handler above so JSON and binary resume downloads share one API.
export default async (request, context) => {
  const url = new URL(request.url);
  const raw = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const event = {
    httpMethod: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    body: raw || null,
    queryStringParameters: Object.fromEntries(url.searchParams.entries())
  };
  const result = await legacyHandler(event);
  const headers = new Headers(result.headers || {});
  const body = result.isBase64Encoded
    ? Buffer.from(result.body || "", "base64")
    : (result.body ?? "");
  return new Response(body, { status: result.statusCode || 200, headers });
};
