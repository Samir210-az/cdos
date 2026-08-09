import { Pool } from 'pg';

/**
 * İKİ AYRI POOL — Faz 3.1/3.2 tələbi:
 *  - appPool: cdos_app (RLS-ə tabedir) — bütün backend biznes məntiqi BUNU istifadə edir.
 *  - migratorPool: cdos_migrator (BYPASSRLS) — YALNIZ migration/seed skriptlərində
 *    istifadə olunur, bu faylın backend runtime kodundan import edilməsi qadağandır.
 */

let _appPool: Pool | null = null;

export function getAppPool(): Pool {
  if (!_appPool) {
    const url = process.env.DATABASE_APP_URL;
    if (!url) {
      throw new Error('DATABASE_APP_URL .env-də təyin olunmayıb.');
    }
    _appPool = new Pool({ connectionString: url, max: 10 });
  }
  return _appPool;
}

export async function closeAppPool(): Promise<void> {
  if (_appPool) {
    await _appPool.end();
    _appPool = null;
  }
}
