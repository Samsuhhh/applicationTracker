-- CareerOS / SamOS online — D1 schema (Cloudflare SQLite)
-- Single source of truth for structured records. R2 holds rendered files (keys referenced here).
-- Apply with:  wrangler d1 execute careeros --file=./schema.sql            (remote)
--        or:   wrangler d1 execute careeros --local --file=./schema.sql   (local dev)
-- Safe to re-run: every table uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS applications (
  id                     TEXT PRIMARY KEY,   -- app-<ts>-<rand>
  company                TEXT NOT NULL,
  role                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'applied',  -- wishlist|applied|interview|offer|rejected
  applied_date           TEXT,               -- ISO date, UI defaults to today on create
  deadline               TEXT,               -- application deadline (powers "needs attention")
  pay                    TEXT,
  link                   TEXT,               -- job posting URL
  notes                  TEXT,
  follow_up_date         TEXT,
  jd_text                TEXT,               -- job description, kept for tailoring
  submitted              INTEGER NOT NULL DEFAULT 0,  -- 0|1, human Level-3 action
  submitted_at           TEXT,
  submitted_material_ids TEXT,               -- comma list of materials.id actually sent
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  employer    TEXT,
  date_range  TEXT,
  metric      TEXT,
  themes      TEXT NOT NULL,                 -- comma tags: PROCESS,AI,SYSTEMS,...
  level_note  TEXT,                          -- honesty scoping, e.g. "worked-with, not expert"
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,              -- resume|cover_letter
  variant        TEXT,                       -- master|execops|swe|tailored
  application_id TEXT,                       -- null for base resumes
  markdown       TEXT NOT NULL,
  r2_key_docx    TEXT,
  r2_key_pdf     TEXT,
  render_status  TEXT NOT NULL DEFAULT 'none', -- none|queued|rendering|ready|error
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS research_briefs (
  id             TEXT PRIMARY KEY,
  company        TEXT NOT NULL,
  application_id TEXT,
  markdown       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS outreach (
  id             TEXT PRIMARY KEY,
  application_id TEXT,
  person_name    TEXT,                       -- verified/public only, never invented
  person_title   TEXT,
  source         TEXT,                       -- apollo|public|manual
  channel        TEXT,                       -- linkedin|email
  draft          TEXT,
  status         TEXT NOT NULL DEFAULT 'draft', -- draft|approved|sent (send is Level 3, human)
  created_at     TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS interview_prep (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  markdown       TEXT NOT NULL,              -- likely questions + matched STAR stories + research recap
  r2_key_pdf     TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,                 -- application|material|research|outreach|prep
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,                 -- created|updated|rendered|approved|submitted|...
  actor       TEXT NOT NULL,                 -- jarvis|career-manager|human
  detail      TEXT,
  at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_materials_application ON materials(application_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);
