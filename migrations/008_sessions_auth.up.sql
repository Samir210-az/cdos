-- 008_sessions_auth
--
-- QEYD (RLS N/A üçün əsaslandırma):
-- Bu cədvəl "identity layer"-ə aiddir, "tenant clinical data" deyil.
-- Login/refresh axını zamanı (əvvəl JWT verilməzdən) heç bir tenant context
-- (app.current_org) hələ məlum deyil — istifadəçi hansı mərkəzə aid session-u
-- refresh etdiyini sübut etmək üçün YALNIZ refresh_token_hash-ı təqdim edir.
-- Ona görə bu cədvəl organization_id ilə RLS-ə tabe edilmir; qorunma
-- (a) token hash-ın kriptoqrafik gizliliyi, (b) application-layer-də
-- sorğunun YALNIZ user_id üzərindən aparılması ilə təmin olunur.
-- Faz 3.1 Fix#2: JWT-də active_organization_id token verilişi ANINDA seçilir
-- (membership-dən), sessions_auth sətrində "hansı org" sonradan JWT-nin
-- payload-ında imzalanır, DB sətrində ayrıca saxlanmır.

CREATE TABLE sessions_auth (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  device_info         TEXT,
  ip                  INET,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ,
  replaced_by         UUID REFERENCES sessions_auth(id)   -- refresh-rotation zənciri / reuse-detection üçün
);

CREATE INDEX idx_sessions_auth_user ON sessions_auth(user_id);
CREATE INDEX idx_sessions_auth_active ON sessions_auth(user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
