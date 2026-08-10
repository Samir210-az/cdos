-- 023_goal_measurements_session_fk
--
-- Faz 3.5 GAP-ının bağlanması (Faz 3.6 bənd 16): "sessions" indi mövcuddur,
-- "goal_measurements.session_id" üçün composite FK əlavə olunur.
--
-- TƏHLÜKƏSİZLİK YOXLAMASI (bənd 16 tələbi): migration tətbiq olunmazdan əvvəl
-- orphan data yoxlanıldı — "SELECT COUNT(*) FROM goal_measurements WHERE
-- session_id IS NOT NULL" = 0. Orphan tapılmadı, data silinmədi, uydurma
-- relation yaradılmadı. session_id NULLABLE olaraq qalır (freeze-dəki kimi).

DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM goal_measurements gm
  WHERE gm.session_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.organization_id = gm.organization_id AND s.id = gm.session_id
    );
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'goal_measurements-də % orphan session_id qeydi tapıldı — migration təhlükəsiz deyil, dayandırılır', orphan_count;
  END IF;
END $$;

ALTER TABLE goal_measurements
  ADD CONSTRAINT fk_goal_measurements_session
  FOREIGN KEY (organization_id, session_id)
  REFERENCES sessions (organization_id, id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
