import { getAppPool } from '../../common/db/pool';

export class AuditError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AuditAction =
  | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'TOKEN_REUSE'
  | 'PERMISSION_DENIED' | 'TENANT_ACCESS_DENIED'
  | 'CHILD_VIEWED' | 'CHILD_UPDATED'
  | 'ASSESSMENT_CREATED' | 'ASSESSMENT_LOCKED'
  | 'PLAN_APPROVED' | 'SESSION_LOCKED' | 'SESSION_AMENDED'
  | 'AI_GENERATED' | 'AI_APPROVED'
  | 'DOCUMENT_VIEWED' | 'DOCUMENT_DOWNLOADED'
  | 'CONSENT_GRANTED' | 'CONSENT_REVOKED' | 'DATA_EXPORTED'
  | 'MEMBER_ROLE_CHANGED' | 'MEMBER_BRANCH_CHANGED'
  | 'BREAK_GLASS_GRANTED' | 'BREAK_GLASS_USED';

export type AuditResult = 'SUCCESS' | 'DENIED';

/**
 * QEYD (Faz 3.12 Phase 3 — həssas məlumat sızmasının qarşısını almaq):
 * Bu açar adları (case-insensitive) hər hansı audit payload-dan (before/after)
 * BUDANIB "***REDACTED***" ilə əvəz olunur. Yeni açar/event formatı UYDURULMUR —
 * bu, yalnız mövcud JSONB sahələrinin təhlükəsiz filtrasiyasıdır.
 */
const SENSITIVE_KEYS = [
  'password', 'password_hash', 'token', 'refresh_token', 'access_token',
  'jwt', 'secret', 'authorization', 'refresh_token_hash', 'storage_key',
];

function sanitize(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) return payload.map(sanitize);
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return payload;
}

export interface AuditEventInput {
  organizationId: string | null; // NULL yalnız LOGIN/LOGIN_FAILED kimi tenant-context-dən əvvəlki hadisələr üçün (bax 034 migration QEYD 2)
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  result: AuditResult;
}

/**
 * Audit qeydi yaradır. "organization_id" NULL ola bilər (yalnız tenant-context-dən
 * əvvəlki hadisələr) — digər hallarda mütləq təyin edilməlidir (RLS WITH CHECK
 * bunu təmin edir, bax 034 migration).
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<{ id: string }> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.organizationId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_org', input.organizationId]);
    } else {
      await client.query("SELECT set_config('app.current_org', '', true)");
    }
    const res = await client.query(
      `INSERT INTO audit_logs
         (organization_id, actor_user_id, action, target_type, target_id, before, after,
          ip_address, user_agent, request_id, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        input.organizationId,
        input.actorUserId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.before !== undefined ? JSON.stringify(sanitize(input.before)) : null,
        input.after !== undefined ? JSON.stringify(sanitize(input.after)) : null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
        input.result,
      ],
    );
    await client.query('COMMIT');
    return { id: res.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Tenant-scoped sorğu — yalnız cari organization-un audit sətirlərini gətirir (RLS). */
export async function listAuditEvents(
  organizationId: string,
  filters: { action?: AuditAction; targetType?: string; targetId?: string } = {},
): Promise<any[]> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org', organizationId]);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.action) {
      params.push(filters.action);
      conditions.push(`action = $${params.length}`);
    }
    if (filters.targetType) {
      params.push(filters.targetType);
      conditions.push(`target_type = $${params.length}`);
    }
    if (filters.targetId) {
      params.push(filters.targetId);
      conditions.push(`target_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await client.query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC`, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
