import { MemberScope, ScopeCacheAdapter } from './scope-cache.interface';

interface Entry {
  value: MemberScope;
  expiresAt: number;
}

/**
 * Tək-process fallback. Production-da (çox instansiyalı deployment) Redis
 * adapter ilə əvəz olunmalıdır — invalidation yalnız bu process daxilində işləyir.
 * Bu, sənədləşdirilmiş, bilərəkdən qəbul edilmiş MVP məhdudiyyətidir (bax
 * FINAL REPORT → Known limitations).
 */
export class InMemoryScopeCacheAdapter implements ScopeCacheAdapter {
  private store = new Map<string, Entry>();

  async get(memberId: string): Promise<MemberScope | null> {
    const entry = this.store.get(memberId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(memberId);
      return null;
    }
    return entry.value;
  }

  async set(memberId: string, scope: MemberScope, ttlSeconds: number): Promise<void> {
    this.store.set(memberId, { value: scope, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async invalidate(memberId: string): Promise<void> {
    this.store.delete(memberId);
  }
}
