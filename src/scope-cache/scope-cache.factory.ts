import { ScopeCacheAdapter } from './scope-cache.interface';
import { InMemoryScopeCacheAdapter } from './in-memory-scope-cache.adapter';

let _instance: ScopeCacheAdapter | null = null;

export function getScopeCache(): ScopeCacheAdapter {
  if (_instance) return _instance;

  if (process.env.REDIS_URL) {
    // QEYD: Redis client paketi (ioredis) bu fazda repository-yə ƏLAVƏ OLUNMAYIB
    // (Faz 3.2 bənd 14: "bütün Redis sistemini zorla qurma"). REDIS_URL təyin
    // olunsa belə, hazırkı fazda buraya yalnız aydın xəta ilə düşülür ki,
    // səhv "sükutla in-memory-yə keçmə" baş verməsin (fail-loud, fail-safe deyil).
    throw new Error(
      'REDIS_URL təyin olunub, lakin Redis adapter implementasiyası Faz 3.2 ' +
        'scope-una daxil deyil. RedisScopeCacheAdapter gələcək fazda əlavə olunacaq. ' +
        'Hazırkı fazda REDIS_URL boş buraxılmalıdır (InMemoryScopeCacheAdapter istifadə olunur).',
    );
  }

  _instance = new InMemoryScopeCacheAdapter();
  return _instance;
}

export function resetScopeCacheForTests(): void {
  _instance = null;
}
