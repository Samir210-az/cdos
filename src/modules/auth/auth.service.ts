import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getAppPool } from '../../common/db/pool';
import { withTenantTransaction } from '../../common/db/tenant-context';
import { signAccessToken, verifyAccessToken } from './jwt.service';
import { invalidateMemberScope } from '../../scope-cache/scope-resolver';

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface OrgChoice {
  organizationId: string;
  memberId: string;
}

/** Refresh token-ın YALNIZ hash-i saxlanılır — plaintext heç vaxt DB-yə düşmür. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * LOGIN
 * ------------------------------------------------------------------------
 * "Toyuq-yumurta" problemi (Faz 3.2 bənd 4): login zamanı hələ JWT/tenant
 * context yoxdur. Membership-ləri tapmaq üçün YALNIZ dar əhatəli
 * find_user_org_memberships(user_id) SECURITY DEFINER funksiyası istifadə
 * olunur — bu funksiya yalnız (organization_id, member_id, status) qaytarır,
 * heç bir başqa RLS-qorumalı cədvələ ümumi bypass vermir.
 */
export async function login(
  email: string,
  password: string,
): Promise<
  | { requiresOrgSelection: true; choices: OrgChoice[] }
  | { requiresOrgSelection: false; tokens: TokenPair }
> {
  const pool = getAppPool();
  const { recordAuditEvent } = await import('../audit/audit.service');

  // users cədvəlində RLS yoxdur (platform-level identity) — tenant context lazım deyil.
  const userRes = await pool.query(
    `SELECT id, password_hash, status FROM users WHERE email = $1`,
    [email],
  );
  if (userRes.rowCount === 0) {
    await recordAuditEvent({ organizationId: null, action: 'LOGIN_FAILED', result: 'DENIED' }).catch(() => {});
    throw new AuthError('INVALID_CREDENTIALS', 'Email və ya şifrə yanlışdır.');
  }
  const user = userRes.rows[0];
  if (user.status !== 'ACTIVE') {
    await recordAuditEvent({ organizationId: null, actorUserId: user.id, action: 'LOGIN_FAILED', result: 'DENIED' }).catch(() => {});
    throw new AuthError('USER_SUSPENDED', 'Hesab aktiv deyil.');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await recordAuditEvent({ organizationId: null, actorUserId: user.id, action: 'LOGIN_FAILED', result: 'DENIED' }).catch(() => {});
    throw new AuthError('INVALID_CREDENTIALS', 'Email və ya şifrə yanlışdır.');
  }

  const membershipsRes = await pool.query(
    `SELECT organization_id, member_id, status FROM find_user_org_memberships($1) WHERE status = 'ACTIVE'`,
    [user.id],
  );

  const membershipCount = membershipsRes.rowCount ?? 0;
  if (membershipCount === 0) {
    await recordAuditEvent({ organizationId: null, actorUserId: user.id, action: 'LOGIN_FAILED', result: 'DENIED' }).catch(() => {});
    throw new AuthError('NO_ACTIVE_MEMBERSHIP', 'İstifadəçinin aktiv mərkəz üzvlüyü yoxdur.');
  }

  if (membershipCount > 1) {
    return {
      requiresOrgSelection: true,
      choices: membershipsRes.rows.map((r: any) => ({
        organizationId: r.organization_id,
        memberId: r.member_id,
      })),
    };
  }

  const choice = membershipsRes.rows[0];
  const tokens = await issueTokenPair(user.id, choice.organization_id);
  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  // Faz 3.13 retrofit: LOGIN (frozen action) — best-effort, ayrıca transaction
  // (login axını hələ vahid tenant transaction-a bağlı deyil).
  await recordAuditEvent({
    organizationId: choice.organization_id,
    actorUserId: user.id,
    action: 'LOGIN',
    result: 'SUCCESS',
  }).catch(() => {});
  return { requiresOrgSelection: false, tokens };
}

/** Login zamanı >1 membership olduqda, seçim edildikdən sonra çağırılır. */
export async function completeLoginWithOrgChoice(
  userId: string,
  organizationId: string,
): Promise<TokenPair> {
  const pool = getAppPool();
  const { recordAuditEvent } = await import('../audit/audit.service');
  const check = await pool.query(
    `SELECT status FROM find_user_org_memberships($1) WHERE organization_id = $2`,
    [userId, organizationId],
  );
  if (check.rowCount === 0 || check.rows[0].status !== 'ACTIVE') {
    await recordAuditEvent({ organizationId, actorUserId: userId, action: 'LOGIN_FAILED', result: 'DENIED' }).catch(() => {});
    throw new AuthError('ACCESS_DENIED', 'Bu organization üçün aktiv üzvlük yoxdur.');
  }
  const tokens = await issueTokenPair(userId, organizationId);
  await recordAuditEvent({ organizationId, actorUserId: userId, action: 'LOGIN', result: 'SUCCESS' }).catch(() => {});
  return tokens;
}

async function issueTokenPair(userId: string, organizationId: string): Promise<TokenPair> {
  const pool = getAppPool();
  const refreshToken = generateOpaqueToken();
  const refreshHash = hashToken(refreshToken);

  const sessionRes = await pool.query(
    `INSERT INTO sessions_auth (user_id, refresh_token_hash) VALUES ($1, $2) RETURNING id`,
    [userId, refreshHash],
  );
  const sessionId = sessionRes.rows[0].id;

  const accessToken = signAccessToken({
    user_id: userId,
    active_organization_id: organizationId,
    session_id: sessionId,
  });

  return { accessToken, refreshToken };
}

/**
 * REFRESH ROTATION + REUSE DETECTION
 * ------------------------------------------------------------------------
 * Hər refresh sorğusunda köhnə token "revoked" edilir və yeni token verilir.
 * Əgər artıq "revoked_at" dolu olan (yəni əvvəl istifadə edilmiş) bir refresh
 * token TƏKRAR göndərilirsə — bu, oğurlanma əlaməti hesab olunur: o istifadəçinin
 * BÜTÜN aktiv sessiyaları dərhal ləğv edilir (TOKEN_REUSE hadisəsi).
 */
export async function refresh(
  oldRefreshToken: string,
  activeOrganizationId: string,
): Promise<TokenPair> {
  const pool = getAppPool();
  const oldHash = hashToken(oldRefreshToken);

  const res = await pool.query(
    `SELECT id, user_id, revoked_at FROM sessions_auth WHERE refresh_token_hash = $1`,
    [oldHash],
  );

  if (res.rowCount === 0) {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token etibarsızdır.');
  }
  const session = res.rows[0];

  if (session.revoked_at) {
    // REUSE DETECTED — bütün user sessiyalarını ləğv et.
    await pool.query(
      `UPDATE sessions_auth SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.user_id],
    );
    // TOKEN_REUSE audit hadisəsi — Faz 3.12-dən bəri REAL audit_logs sətri
    // yazılır (əvvəllər console.warn idi, indi Faz 3.1 audit modelinə uyğun
    // həqiqi INSERT-dir).
    const { recordAuditEvent } = await import('../audit/audit.service');
    await recordAuditEvent({
      organizationId: activeOrganizationId,
      actorUserId: session.user_id,
      action: 'TOKEN_REUSE',
      targetType: 'sessions_auth',
      targetId: session.id,
      result: 'DENIED',
    }).catch(() => {
      // Audit yazısının uğursuz olması əsas təhlükəsizlik əməliyyatını (bütün
      // sessiyaların ləğvi artıq YUXARIDA baş verib) bloklamamalıdır.
    });
    throw new AuthError('TOKEN_REUSE_DETECTED', 'Refresh token təkrar istifadə aşkarlandı — bütün sessiyalar ləğv edildi.');
  }

  const newRefreshToken = generateOpaqueToken();
  const newHash = hashToken(newRefreshToken);

  const newSessionRes = await pool.query(
    `INSERT INTO sessions_auth (user_id, refresh_token_hash) VALUES ($1, $2) RETURNING id`,
    [session.user_id, newHash],
  );
  const newSessionId = newSessionRes.rows[0].id;

  await pool.query(
    `UPDATE sessions_auth SET revoked_at = now(), replaced_by = $1 WHERE id = $2`,
    [newSessionId, session.id],
  );

  // activeOrganizationId client tərəfindən göndərilsə də, YALNIZ mövcud
  // aktiv membership-lə təsdiqləndikdən sonra JWT-yə yazılır (bənd 22: client
  // öz tenant scope-unu müəyyən edə bilməz — bu, yalnız təklifdir, doğrulanır).
  const membershipCheck = await pool.query(
    `SELECT status FROM find_user_org_memberships($1) WHERE organization_id = $2`,
    [session.user_id, activeOrganizationId],
  );
  if (membershipCheck.rowCount === 0 || membershipCheck.rows[0].status !== 'ACTIVE') {
    throw new AuthError('ACCESS_DENIED', 'Bu organization üçün aktiv üzvlük yoxdur.');
  }

  const accessToken = signAccessToken({
    user_id: session.user_id,
    active_organization_id: activeOrganizationId,
    session_id: newSessionId,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * SWITCH ORGANIZATION
 * ------------------------------------------------------------------------
 * Yeni access+refresh cütü verir (yeni sessiya), köhnə refresh dərhal ləğv edilir.
 * Scope cache invalidasiyası: köhnə VƏ yeni member_id üçün (təhlükəsiz tərəf seçimi).
 */
export async function switchOrganization(
  currentAccessToken: string,
  targetOrganizationId: string,
): Promise<TokenPair> {
  const pool = getAppPool();
  const payload = verifyAccessToken(currentAccessToken);

  const membershipCheck = await pool.query(
    `SELECT member_id, status FROM find_user_org_memberships($1) WHERE organization_id = $2`,
    [payload.user_id, targetOrganizationId],
  );
  if (membershipCheck.rowCount === 0 || membershipCheck.rows[0].status !== 'ACTIVE') {
    throw new AuthError('ACCESS_DENIED', 'Bu organization üçün aktiv üzvlük yoxdur.');
  }

  // Cari sessiyanı ləğv et, yeni ver (bir sessiya = bir aktiv-org kontekst).
  await pool.query(`UPDATE sessions_auth SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
    payload.session_id,
  ]);

  const tokens = await issueTokenPair(payload.user_id, targetOrganizationId);
  await invalidateMemberScope(membershipCheck.rows[0].member_id);
  return tokens;
}

/** LOGOUT — sessiyanı dərhal ləğv edir. */
export async function logout(sessionId: string): Promise<void> {
  const pool = getAppPool();
  const sessRes = await pool.query(`SELECT user_id FROM sessions_auth WHERE id = $1`, [sessionId]);
  await pool.query(`UPDATE sessions_auth SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
    sessionId,
  ]);
  // Faz 3.13 retrofit: LOGOUT (frozen action). QEYD (limitation): "sessions_auth"
  // organization_id daşımır (bax 008 migration — login/refresh tenant-context-dən
  // əvvəl işləyir), ona görə organization_id=NULL (RLS WITH CHECK bunu icazə verir).
  const { recordAuditEvent } = await import('../audit/audit.service');
  await recordAuditEvent({
    organizationId: null,
    actorUserId: sessRes.rows[0]?.user_id ?? null,
    action: 'LOGOUT',
    targetType: 'sessions_auth',
    targetId: sessionId,
    result: 'SUCCESS',
  }).catch(() => {});
}

export { withTenantTransaction };
