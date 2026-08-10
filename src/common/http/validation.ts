import { BadRequestException } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Faz 3.15 bənd IV: yüngül, əlavə asılılıq tələb etməyən request validation.
 * DTO-lar mövcud service/DB contract-larından çıxarılıb — yeni sahə uydurulmayıb.
 */
export function requireUUID(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new BadRequestException(`"${field}" düzgün UUID olmalıdır.`);
  }
  return value;
}

export function optionalUUID(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireUUID(value, field);
}

export function requireString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`"${field}" boş olmayan string olmalıdır.`);
  }
  if (opts.min !== undefined && value.length < opts.min) {
    throw new BadRequestException(`"${field}" ən azı ${opts.min} simvol olmalıdır.`);
  }
  if (opts.max !== undefined && value.length > opts.max) {
    throw new BadRequestException(`"${field}" ən çox ${opts.max} simvol olmalıdır.`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field);
}

export function requireNumber(value: unknown, field: string, opts: { min?: number } = {}): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new BadRequestException(`"${field}" ədəd olmalıdır.`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new BadRequestException(`"${field}" ən azı ${opts.min} olmalıdır.`);
  }
  return value;
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException(`"${field}" bunlardan biri olmalıdır: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`"${field}" array olmalıdır.`);
  }
  return value;
}

export function requireBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Request body düzgün JSON object olmalıdır.');
  }
  return body as Record<string, unknown>;
}
