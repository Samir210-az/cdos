/**
 * Faz 3.18 bənd 2: production startup üçün minimal environment validasiyası.
 * Mövcud environment dəyişən adları (.env.example-dən götürülüb, uydurulmayıb):
 *   DATABASE_MIGRATOR_URL, DATABASE_APP_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
 *   JWT_ACCESS_TTL_MINUTES, JWT_REFRESH_TTL_DAYS, REDIS_URL, APP_PORT, NODE_ENV.
 */

export class EnvironmentValidationError extends Error {}

const REQUIRED_VARS = ['DATABASE_MIGRATOR_URL', 'DATABASE_APP_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

// .env.example-dəki placeholder dəyərlər — production-da bunlarla start QADAĞANDIR.
const INSECURE_PLACEHOLDER_PATTERNS = [/^CHANGE_ME/i, /^changeme$/i, /^secret$/i, /^password$/i];

const MIN_SECRET_LENGTH = 16;

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_VARS.filter((k) => !env[k] || env[k]!.trim().length === 0);
  if (missing.length > 0) {
    throw new EnvironmentValidationError(
      `Kritik environment dəyişənləri təyin olunmayıb: ${missing.join(', ')}. Tətbiq başladıla bilmir.`,
    );
  }

  const isProduction = env.NODE_ENV === 'production';
  const secretLikeVars = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

  for (const key of secretLikeVars) {
    const value = env[key]!;
    const looksInsecure = INSECURE_PLACEHOLDER_PATTERNS.some((p) => p.test(value));
    if (isProduction && looksInsecure) {
      throw new EnvironmentValidationError(
        `${key} production-da placeholder/default dəyərlə (${value.slice(0, 12)}...) təyin oluna bilməz.`,
      );
    }
    if (isProduction && value.length < MIN_SECRET_LENGTH) {
      throw new EnvironmentValidationError(`${key} production-da ən azı ${MIN_SECRET_LENGTH} simvol olmalıdır.`);
    }
  }

  if (env.APP_PORT !== undefined && env.APP_PORT !== '') {
    const portNum = Number(env.APP_PORT);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
      throw new EnvironmentValidationError(`APP_PORT etibarsızdır: "${env.APP_PORT}".`);
    }
  }
}
