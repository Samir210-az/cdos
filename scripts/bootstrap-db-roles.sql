-- CDOS — Bir dəfəlik DB rol bootstrap skripti
-- -----------------------------------------------------------------------
-- BU FAYL MIGRATION DEYİL və migration runner tərəfindən icra edilmir.
-- Səbəb (Faz 3.2 bənd 3): cdos_migrator rolu HƏLƏ MÖVCUD OLMAYANDA
-- migration-lar işə düşə bilməz (migration runner məhz bu rolla qoşulur) —
-- "toyuq-yumurta" problemi. Ona görə rol yaratma addımı migration-lardan
-- AYRI, superuser (adətən "postgres") tərəfindən, deployment zamanı BİR DƏFƏ
-- icra olunan ayrıca skriptdir.
--
-- İstifadə: superuser ilə işə salın, məs.:
--   psql "postgresql://postgres@host:5432/postgres" -f scripts/bootstrap-db-roles.sql
--
-- Production-da parolları mütləq dəyişdirin (aşağıdakılar yalnız DEV nümunəsidir,
-- real dəyərlər secrets manager-dən verilməlidir).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cdos_migrator') THEN
    CREATE ROLE cdos_migrator WITH LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' BYPASSRLS CREATEDB;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cdos_app') THEN
    CREATE ROLE cdos_app WITH LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Verilənlər bazası (yoxdursa yaradılmalıdır, adətən ayrıca addım):
-- CREATE DATABASE cdos OWNER cdos_migrator;

-- \c cdos   -- (bu skripti "cdos" DB-sinə qoşulmuş halda icra edin)

GRANT ALL PRIVILEGES ON DATABASE cdos TO cdos_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO cdos_migrator;
GRANT USAGE ON SCHEMA public TO cdos_app;

-- cdos_migrator tərəfindən yaradılan BÜTÜN gələcək cədvəllərə cdos_app
-- avtomatik olaraq CRUD səlahiyyəti alır (RLS bu səlahiyyəti əlavə məhdudlaşdırır,
-- əvəz etmir — iki qat müdafiə).
ALTER DEFAULT PRIVILEGES FOR ROLE cdos_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cdos_app;

COMMENT ON ROLE cdos_migrator IS 'Yalnız migration/seed skriptləri üçün. BYPASSRLS. Backend tətbiqi BU ROLLA HEÇ VAXT qoşulmur.';
COMMENT ON ROLE cdos_app IS 'Backend application connection pool. RLS-ə tabedir (NOBYPASSRLS).';
