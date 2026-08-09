import { withTenantTransaction } from '../common/db/tenant-context';
import { getScopeCache } from './scope-cache.factory';
import { MemberScope } from './scope-cache.interface';

const SCOPE_TTL_SECONDS = 5 * 60; // Faz 3.1 Fix#2: 5 dəqiqə

/**
 * Cari üzvün (member) filial və rol scope-unu qaytarır.
 * Qayda (Faz 3.1 Fix#4 / Faz 3.2 bənd 10):
 *   scope_type = 'SELECTED_BRANCHES' olmadıqda member_branches sətirləri
 *   OLSA BELƏ authorization scope kimi İSTİFADƏ EDİLMİR.
 */
export async function resolveMemberScope(
  organizationId: string,
  memberId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<MemberScope> {
  const cache = getScopeCache();
  if (!opts.bypassCache) {
    const cached = await cache.get(memberId);
    if (cached && cached.organizationId === organizationId) return cached;
  }

  const scope = await withTenantTransaction(organizationId, async (client) => {
    const memberRes = await client.query(
      `SELECT id, scope_type, status FROM organization_members WHERE id = $1 AND organization_id = $2`,
      [memberId, organizationId],
    );
    if (memberRes.rowCount === 0) {
      throw new Error('Member tapılmadı və ya bu organization-a aid deyil.');
    }
    const member = memberRes.rows[0];

    const rolesRes = await client.query(
      `SELECT r.code FROM member_roles mr JOIN roles r ON r.id = mr.role_id
       WHERE mr.organization_id = $1 AND mr.member_id = $2`,
      [organizationId, memberId],
    );

    let branchIds: string[] = [];
    if (member.scope_type === 'SELECTED_BRANCHES') {
      const branchesRes = await client.query(
        `SELECT branch_id FROM member_branches WHERE organization_id = $1 AND member_id = $2`,
        [organizationId, memberId],
      );
      branchIds = branchesRes.rows.map((r: any) => r.branch_id);
    }
    // scope_type = 'ALL_BRANCHES' -> branchIds boş qalır, resolver çağıran kod
    // bunu "bütün filiallar" kimi şərh edir (scopeType sahəsinə əsaslanaraq, HEÇ VAXT boş=ALL demək deyil)
    // scope_type = 'NO_BRANCH' -> branchIds boş, "heç bir filial" mənasında.

    const result: MemberScope = {
      memberId: member.id,
      organizationId,
      scopeType: member.scope_type,
      branchIds,
      roleCodes: rolesRes.rows.map((r: any) => r.code),
      status: member.status,
    };
    return result;
  });

  await cache.set(memberId, scope, SCOPE_TTL_SECONDS);
  return scope;
}

/** Rol/filial dəyişikliyi zamanı DƏRHAL çağırılmalıdır (event-driven invalidation). */
export async function invalidateMemberScope(memberId: string): Promise<void> {
  await getScopeCache().invalidate(memberId);
}

/** Verilmiş filialın member-in scope-unda olub-olmadığını yoxlayır. */
export function isBranchInScope(scope: MemberScope, branchId: string): boolean {
  if (scope.scopeType === 'ALL_BRANCHES') return true;
  if (scope.scopeType === 'SELECTED_BRANCHES') return scope.branchIds.includes(branchId);
  return false; // NO_BRANCH
}
