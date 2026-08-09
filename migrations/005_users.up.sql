-- 005_users
-- User platform-level identity entity-sidir (Faz 3.1: tenant-a aid membership
-- organization_members-dədir, bu cədvəldə organization_id YOXDUR — RLS tələb olunmur).
-- Password YALNIZ hash saxlanılır (bcrypt), plain text QƏTİ SAXLANMIR.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_status ON users(status);
