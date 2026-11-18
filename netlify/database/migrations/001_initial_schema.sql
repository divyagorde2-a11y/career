CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','recruiter','college_admin')),
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  location TEXT,
  college TEXT,
  degree TEXT,
  academic_year TEXT,
  cgpa NUMERIC(4,2),
  target_role TEXT,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  about TEXT,
  resume_blob_key TEXT,
  resume_file_name TEXT,
  resume_content_type TEXT,
  resume_size BIGINT,
  resume_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  description TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  work_mode TEXT CHECK (work_mode IN ('remote','hybrid','onsite')),
  employment_type TEXT NOT NULL DEFAULT 'internship',
  stipend TEXT,
  description TEXT NOT NULL DEFAULT '',
  required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  eligibility TEXT,
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused','closed')),
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied','under_review','shortlisted','interview','selected','rejected','withdrawn')),
  cover_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS saved_opportunities (
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(student_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status_created ON opportunities(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_student_created ON applications(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

INSERT INTO opportunities
(id,title,company_name,location,work_mode,employment_type,stipend,description,required_skills,deadline,status,verified)
VALUES
('10000000-0000-4000-8000-000000000001','Frontend Developer Intern','Northstar Labs','Pune, Maharashtra','hybrid','internship','₹18,000 / month','Build accessible interfaces, translate product designs into responsive components and improve user experience.','["React","JavaScript","CSS","Git"]'::jsonb,'2026-12-15','published',true),
('10000000-0000-4000-8000-000000000002','Data Analyst Intern','Orbit Analytics','Remote, India','remote','internship','₹15,000 / month','Work with business datasets, prepare reports and turn operational data into useful insights.','["Python","SQL","Excel","Power BI"]'::jsonb,'2026-12-20','published',true),
('10000000-0000-4000-8000-000000000003','Junior Software Engineer','BluePebble Systems','Bengaluru, Karnataka','onsite','full-time','₹5–7 LPA','Join an engineering team building reliable APIs and customer-facing software.','["Java","DSA","REST APIs","Git"]'::jsonb,'2026-12-28','published',true),
('10000000-0000-4000-8000-000000000004','UI/UX Design Intern','PixelForge Studio','Mumbai, Maharashtra','hybrid','internship','₹12,000 / month','Create wireframes, prototypes and user research outputs with a product design team.','["Figma","Wireframing","Prototyping","Research"]'::jsonb,'2026-12-18','published',true)
ON CONFLICT(id) DO NOTHING;

ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS resume_file_name TEXT;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS resume_content_type TEXT;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS resume_size BIGINT;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS resume_uploaded_at TIMESTAMPTZ;
