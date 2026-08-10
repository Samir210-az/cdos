-- 022_session_goals
--
-- Bax 021-ci migration-un "QEYD 1"-i: orijinal "goal_ids(UUID[])" massiv
-- sütunu əvəzinə composite-FK-nin mümkün olması üçün junction cədvəl.

CREATE TABLE session_goals (
  organization_id UUID NOT NULL,
  session_id      UUID NOT NULL,
  goal_id         UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, goal_id),
  FOREIGN KEY (organization_id, session_id)
    REFERENCES sessions (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, goal_id)
    REFERENCES goals (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_session_goals_org ON session_goals(organization_id);
CREATE INDEX idx_session_goals_org_session ON session_goals(organization_id, session_id);
CREATE INDEX idx_session_goals_org_goal ON session_goals(organization_id, goal_id);

ALTER TABLE session_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_session_goals ON session_goals
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
