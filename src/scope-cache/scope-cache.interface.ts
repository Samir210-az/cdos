export interface MemberScope {
  memberId: string;
  organizationId: string;
  scopeType: 'ALL_BRANCHES' | 'SELECTED_BRANCHES' | 'NO_BRANCH';
  branchIds: string[]; // yalnız scopeType='SELECTED_BRANCHES' olduqda mənalıdır
  roleCodes: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
}

/**
 * Faz 3.1 Fix#2 üçün abstraksiya sərhədi.
 * Bu fazda Redis REPOSITORY-də mövcud deyil — InMemoryScopeCacheAdapter istifadə olunur.
 * Redis əlavə olunanda yalnız RedisScopeCacheAdapter aktivləşdirilməlidir,
 * çağıran kod (scope-resolver.ts) DƏYİŞMİR.
 */
export interface ScopeCacheAdapter {
  get(memberId: string): Promise<MemberScope | null>;
  set(memberId: string, scope: MemberScope, ttlSeconds: number): Promise<void>;
  invalidate(memberId: string): Promise<void>;
}
