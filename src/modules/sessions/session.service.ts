import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class SessionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ActorContext {
  organizationId: string;
  memberId: string;
  userId: string;
}

/**
 * QEYD (ARCHITECTURE GAP — Faz 3.6 bənd 20): permission kataloqunda session
 * üçün konkret kod yoxdur. Mövcud rol-kodu pattern istifadə olunur (Faz 3.1
 * Clinical Access Matrix), yeni permission UYDURULMUR.
 */
const APPROVE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

/**
 * Faz 3.6 bənd 2/12: "organization.settings.session_lock_hours" mexanizmi
 * repository-də mövcud deyil (settings entity heç vaxt yaradılmayıb) — tam
 * settings sistemi bu fazda UYDURULMUR. Bunun əvəzinə, sadə, sənədləşdirilmiş
 * default sabit istifadə olunur; funksiya çağıran tərəfə override imkanı
 * verir (testability + gələcəkdə settings sistemi qoşulanda minimal dəyişiklik).
 */
export const DEFAULT_SESSION_LOCK_HOURS = 48;

async function assertActiveAssignment(client: any, organizationId: string, specialistId: string, childId: string) {
  const res = await client.query(
    `SELECT 1 FROM specialist_child_assignments
     WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
    [organizationId, specialistId, childId],
  );
  if (res.rowCount === 0) {
    throw new SessionError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }
}

export async function createSession(
  actor: ActorContext,
  input: { childId: string; specialistId: string; goalIds?: string[] },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  if (!isSpecialist && !isApprover) {
    throw new SessionError('ACCESS_DENIED', 'Session yaratmaq icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    // Specialist_id kimin adına yaradılırsa, ONUN aktiv assignment-i yoxlanılır
    // (actor həm admin, həm də specialist özü ola bilər — hər iki halda assignment mütləqdir).
    await assertActiveAssignment(client, actor.organizationId, input.specialistId, input.childId);

    const res = await client.query(
      `INSERT INTO sessions (organization_id, child_id, specialist_id, status)
       VALUES ($1,$2,$3,'DRAFT') RETURNING id`,
      [actor.organizationId, input.childId, input.specialistId],
    );
    const sessionId = res.rows[0].id;

    if (input.goalIds && input.goalIds.length > 0) {
      for (const goalId of input.goalIds) {
        await client.query(
          `INSERT INTO session_goals (organization_id, session_id, goal_id) VALUES ($1,$2,$3)`,
          [actor.organizationId, sessionId, goalId],
        );
      }
    }
    return { id: sessionId };
  });
}

async function transition(actor: ActorContext, sessionId: string, from: string, to: string, extraSet = ''): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT status FROM sessions WHERE id=$1 AND organization_id=$2`, [
      sessionId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new SessionError('NOT_FOUND', 'Session tapılmadı.');
    if (res.rows[0].status !== from) {
      throw new SessionError('CONFLICT', `Session statusu "${res.rows[0].status}" — bu keçid yalnız "${from}"-dan mümkündür.`);
    }
    await client.query(
      `UPDATE sessions SET status=$1, updated_at=now()${extraSet} WHERE id=$2 AND organization_id=$3`,
      [to, sessionId, actor.organizationId],
    );
  });
}

export const startSession = (actor: ActorContext, sessionId: string) =>
  transition(actor, sessionId, 'DRAFT', 'IN_PROGRESS');

export const completeSession = (actor: ActorContext, sessionId: string) =>
  transition(actor, sessionId, 'IN_PROGRESS', 'COMPLETED', ', completed_at = now()');

/** Servis-səviyyəli LOCK (məs. admin tərəfindən əl ilə) — 48 saat gözləmədən. */
export async function lockSession(actor: ActorContext, sessionId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  if (!scope.roleCodes.some((r) => APPROVE_ROLES.includes(r))) {
    throw new SessionError('ACCESS_DENIED', 'Session LOCK əməliyyatı üçün APPROVE-səviyyəli rol tələb olunur.');
  }
  await transition(actor, sessionId, 'COMPLETED', 'LOCKED', ', locked_at = now()');
}

/**
 * AVROMATIK LOCK — Faz 3.6 bənd 12: "now >= completed_at + lock_hours".
 * Scheduled job infrastrukturu bu fazın scope-unda deyil (bənd 12: "yeni
 * geniş scheduler sistemi yaratma") — bu, DETERMİNİSTİK, çağırıla bilən
 * funksiyadır; xarici cron/job runner tərəfindən çağırılması gözlənilir.
 */
export async function lockExpiredSessions(
  organizationId: string,
  lockHours: number = DEFAULT_SESSION_LOCK_HOURS,
): Promise<{ lockedCount: number; lockedIds: string[] }> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(
      `UPDATE sessions
       SET status='LOCKED', locked_at=now(), updated_at=now()
       WHERE organization_id=$1 AND status='COMPLETED'
         AND completed_at IS NOT NULL
         AND now() >= completed_at + ($2 || ' hours')::interval
       RETURNING id`,
      [organizationId, lockHours],
    );
    return { lockedCount: res.rowCount ?? 0, lockedIds: res.rows.map((r: any) => r.id) };
  });
}

/** LOCKED session-a düzəliş — əsas sətir dəyişmir, yeni amendment sətri yaradılır. */
export async function amendSession(
  actor: ActorContext,
  input: { sessionId: string; newData: Record<string, unknown>; reason: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  if (!isSpecialist && !isApprover) {
    throw new SessionError('ACCESS_DENIED', 'Session amend etmək icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    const sessRes = await client.query(`SELECT * FROM sessions WHERE id=$1 AND organization_id=$2`, [
      input.sessionId,
      actor.organizationId,
    ]);
    if (sessRes.rowCount === 0) throw new SessionError('NOT_FOUND', 'Session tapılmadı.');
    if (sessRes.rows[0].status !== 'LOCKED') {
      throw new SessionError('CONFLICT', 'Amendment yalnız LOCKED session üçün mümkündür.');
    }

    const res = await client.query(
      `INSERT INTO session_amendments (organization_id, session_id, editor_id, previous_data, new_data, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        actor.organizationId,
        input.sessionId,
        actor.userId,
        JSON.stringify(sessRes.rows[0]),
        JSON.stringify(input.newData),
        input.reason,
      ],
    );
    return { id: res.rows[0].id };
  });
}

export async function getSession(actor: ActorContext, sessionId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT * FROM sessions WHERE id=$1 AND organization_id=$2`, [
      sessionId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new SessionError('NOT_FOUND', 'Session tapılmadı.');
    return res.rows[0];
  });
}

export async function getChildSessions(actor: ActorContext, childId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT * FROM sessions WHERE child_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      [childId, actor.organizationId],
    );
    return res.rows;
  });
}

export async function getSessionAmendments(actor: ActorContext, sessionId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT * FROM session_amendments WHERE session_id=$1 AND organization_id=$2 ORDER BY created_at ASC`,
      [sessionId, actor.organizationId],
    );
    return res.rows;
  });
}
