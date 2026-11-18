# CareerPilot AI — Native Netlify Full Stack

This version uses **Netlify Database (managed PostgreSQL)**. It does not use Supabase, Firebase, or another external database.

## What is included
- Existing CareerPilot landing page and student workspace UI
- Netlify Functions API at `/api/*`
- Native Netlify Database integration using `@netlify/database`
- Automatic SQL migration at `netlify/database/migrations/001_initial_schema.sql`
- Student registration and login with bcrypt password hashing
- Signed, HttpOnly, Secure, SameSite=Lax session cookie
- Persistent student profiles, published opportunities, saved opportunities and applications
- Private resume storage using Netlify Blobs, with ownership-checked upload/download/delete endpoints
- PDF and DOCX validation, 4 MB per-file limit, replace and delete controls
- Sample opportunity records created by the first migration
- Student dashboard checks authentication and redirects logged-out visitors

## 1. Netlify plan requirement
Netlify Database is available on **credit-based Netlify plans**. Database compute and bandwidth consume credits. Check your plan and usage before production deployment:
https://docs.netlify.com/build/data-and-storage/netlify-database/

## 2. Deploy through Git (required for Functions and migrations)
1. Extract this ZIP.
2. Create a GitHub repository and upload the project files.
3. In Netlify, choose **Add new project → Import an existing project** and connect that repository.
4. Build settings come from `netlify.toml`: publish directory `public`, build command `npm run build`.
5. Add the environment variable `SESSION_SECRET` with a cryptographically random value of at least 32 characters. Generate one locally, for example with `openssl rand -base64 48`.
6. Deploy. The `@netlify/database` package enables native database provisioning, and Netlify applies committed migrations during deploy.
7. Open `https://YOUR-SITE.netlify.app/api/health`. It should report `database: connected`.

Do not use drag-and-drop deploy for this project: Netlify Functions and database migrations need a Git/CLI build deployment.

## 3. Local development
Install Node.js LTS, then run:

```bash
npm install
npx netlify login
npx netlify link
npx netlify dev
```

For local development, Netlify CLI provides a local database environment. The deployed production database is not the same local sandbox.

## 4. API routes
- `POST /api/auth/register` — create a student account
- `POST /api/auth/login` — sign in
- `POST /api/auth/logout` — clear session
- `GET /api/auth/me` — current user
- `GET /api/profile` and `PATCH /api/profile` — student profile
- `GET /api/opportunities?q=` — published opportunities
- `GET /api/applications` and `POST /api/applications` — application tracker
- `GET /api/saved`, `POST /api/saved`, `DELETE /api/saved/:opportunityId`
- `GET /api/resume` — current user's resume metadata
- `POST /api/resume/upload` — validated PDF/DOCX upload to private Netlify Blobs
- `GET /api/resume/download` — authenticated download (only the owner's resume)
- `DELETE /api/resume` — delete file from Blobs and clear its database record
- `GET /api/notifications`
- `GET /api/health` — database health check

## 5. Important production limitations
This is a working starter backend, not yet a complete public hiring platform:
- Registration currently creates Student accounts only. Recruiter and College Admin registration/permissions need their own verified workflows.
- Email verification, password reset, rate limiting, CAPTCHA/abuse controls and audit logging still need to be added before public launch.
- Resume upload/storage and actual AI resume analysis are not yet implemented.
- Recruiter job posting, recruiter verification, interview scheduling and admin dashboards are not yet implemented.
- Review the schema, privacy policy, backup/restore plan and security controls before accepting real student data.

Never expose `NETLIFY_DB_URL`, a database password, or a session secret in browser code. Database access must remain inside Netlify Functions.


## 6. Resume upload and private storage
The student portal includes a real upload flow:
1. Student selects a PDF or DOCX (maximum 4 MB).
2. Browser sends it to `/api/resume/upload` while the HttpOnly session cookie is included.
3. The function validates extension, declared MIME type, size and basic file signature.
4. The file is stored in the site-wide Netlify Blobs store `careerpilot-private-resumes`, under a key derived from the authenticated user ID.
5. The database stores only the blob key and file metadata.
6. Downloads go through `/api/resume/download`; the function derives the key from the signed-in user's ID and checks the database record. There is no public blob URL.
7. Re-upload replaces that user's prior resume. Delete removes the blob and clears the database metadata.

**Limits and security notes:** This implementation caps resumes at 4 MB to stay within buffered Netlify Function request limits when base64-encoded. Only PDF and DOCX are allowed (legacy `.doc` files are not accepted). The function checks file signatures, but this is not a full malware scan or document-content sanitization pipeline. Before a public production launch, add malware scanning, rate limiting, stronger content inspection and a retention/deletion policy. Avoid logging file contents or tokens.
