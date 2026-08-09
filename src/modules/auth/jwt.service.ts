import jwt from 'jsonwebtoken';

/**
 * FINAL JWT MODEL (Faz 3.1 Fix#2 / Faz 3.2 bənd 13):
 *   { user_id, active_organization_id, session_id, iat, exp }
 * active_branch_ids / roles / permissions BURADA SAXLANMIR.
 */
export interface AccessTokenPayload {
  user_id: string;
  active_organization_id: string;
  session_id: string;
}

function getAccessSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET .env-də təyin olunmayıb.');
  return s;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const ttlMinutes = Number(process.env.JWT_ACCESS_TTL_MINUTES || 15);
  return jwt.sign(payload, getAccessSecret(), { expiresIn: `${ttlMinutes}m` });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getAccessSecret());
  if (typeof decoded === 'string') throw new Error('Yanlış JWT formatı');
  const { user_id, active_organization_id, session_id } = decoded as any;
  if (!user_id || !active_organization_id || !session_id) {
    throw new Error('JWT payload natamamdır');
  }
  return { user_id, active_organization_id, session_id };
}
