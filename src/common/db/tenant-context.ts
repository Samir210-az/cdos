import { PoolClient } from 'pg';
import { getAppPool } from './pool';

/**
 * Faz 3.2 bənd 5 / TEST 10 tələbi:
 * Connection pool-dan gələn client PAYLAŞILAN resursdur — əgər tenant context
 * sadə "SET app.current_org = X" ilə təyin edilsə və unudulsa, növbəti sorğu
 * (başqa request) eyni fiziki connection-ı təkrar istifadə edərkən KÖHNƏ
 * tenant context-i miras ala bilər. Bunun qarşısını almaq üçün:
 *
 *   1. Pool-dan bir client "checkout" edilir (məhz bu request üçün).
 *   2. BEGIN edilir.
 *   3. SET LOCAL app.current_org = $1  — bu, YALNIZ cari transaction daxilində
 *      qüvvədədir, COMMIT/ROLLBACK-də avtomatik silinir (Postgres-in öz təminatı).
 *   4. Sorğular icra olunur.
 *   5. COMMIT/ROLLBACK edilir, client pool-a "release" olunur — təmiz vəziyyətdə.
 *
 * Bu üsulla context sızması struktur olaraq mümkün deyil.
 */
export async function withTenantTransaction<T>(
  organizationId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (organizationId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_org', organizationId]);
    } else {
      // Tenant context yoxdur (məs. login öncəsi) — RLS policy-lər NULL current_org
      // üçün 0 sətir qaytarır (fail-closed), bu YALNIZ tenant-a bağlı olmayan
      // sorğular üçün istifadə olunmalıdır (məs. users cədvəlində email axtarışı).
      await client.query("SELECT set_config('app.current_org', '', true)");
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
