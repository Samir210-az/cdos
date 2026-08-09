#!/usr/bin/env node
/**
 * CDOS Migration Runner
 * -----------------------------------------------------------------------
 * Sadə, şəffaf, "eval" və ya dinamik SQL-dən istifadə etməyən migration
 * alətidir. Faz 3.1 tələbinə uyğun olaraq:
 *   - deterministic (fayl adına görə sıralanır)
 *   - transaction-safe (hər migration öz transaction-ında işləyir)
 *   - reversible (hər migration üçün .up.sql + .down.sql cütü)
 *   - RLS aktivləşdirilməsi CREATE TABLE ilə EYNİ faylda (interleaved)
 *
 * Yalnız cdos_migrator (BYPASSRLS) rolu ilə işləyir — DATABASE_MIGRATOR_URL.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function getClient() {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) {
    throw new Error('DATABASE_MIGRATOR_URL .env-də təyin olunmayıb.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

function listMigrationNames() {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  const names = new Set();
  for (const f of files) {
    const m = f.match(/^(\d+_[a-z0-9_]+)\.(up|down)\.sql$/);
    if (m) names.add(m[1]);
  }
  return Array.from(names).sort(); // "001_..." < "002_..." leksikoqrafik = ədədi sıra (sabit uzunluq prefiks)
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Least-privilege: yalnız cdos_migrator bu cədvələ yaza bilər.
  await client.query(`REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM cdos_app;`).catch(() => {});
}

async function getApplied(client) {
  const res = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC');
  return res.rows.map((r) => r.name);
}

async function up() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const all = listMigrationNames();
    const applied = new Set(await getApplied(client));
    const pending = all.filter((n) => !applied.has(n));

    if (pending.length === 0) {
      console.log('Bütün migration-lar artıq tətbiq olunub. Pending yoxdur.');
      return;
    }

    for (const name of pending) {
      const upFile = path.join(MIGRATIONS_DIR, `${name}.up.sql`);
      const sql = fs.readFileSync(upFile, 'utf8');
      console.log(`→ Tətbiq olunur: ${name}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`  ✓ ${name} uğurla tətbiq olundu`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${name} UĞURSUZ OLDU: ${err.message}`);
        throw err;
      }
    }
    console.log(`Tamamlandı: ${pending.length} migration tətbiq olundu.`);
  } finally {
    await client.end();
  }
}

async function down() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    if (applied.length === 0) {
      console.log('Geri qaytarılacaq migration yoxdur.');
      return;
    }
    const last = applied[applied.length - 1];
    const downFile = path.join(MIGRATIONS_DIR, `${last}.down.sql`);
    if (!fs.existsSync(downFile)) {
      throw new Error(`${last} üçün down.sql tapılmadı — geri qaytarma mümkün deyil.`);
    }
    const sql = fs.readFileSync(downFile, 'utf8');
    console.log(`← Geri qaytarılır: ${last}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [last]);
      await client.query('COMMIT');
      console.log(`  ✓ ${last} geri qaytarıldı`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${last} geri qaytarma UĞURSUZ OLDU: ${err.message}`);
      throw err;
    }
  } finally {
    await client.end();
  }
}

async function status() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const all = listMigrationNames();
    const applied = new Set(await getApplied(client));
    console.log('MIGRATION STATUS');
    console.log('-----------------');
    for (const name of all) {
      console.log(`${applied.has(name) ? '[✓ APPLIED]' : '[  PENDING]'} ${name}`);
    }
  } finally {
    await client.end();
  }
}

const cmd = process.argv[2];
(async () => {
  if (cmd === 'up') await up();
  else if (cmd === 'down') await down();
  else if (cmd === 'status') await status();
  else {
    console.error('İstifadə: node scripts/migrate.js <up|down|status>');
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
