import { ALLOWED_OPERATORS, MAX_NESTING_DEPTH } from './scoring-dsl.types';

export interface ValidationContext {
  validItemCodes: Set<string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Publish-time validasiya (Faz 3.1/3.4 bənd 8). Runtime-da "question not found"
 * kimi struktur xətalarının qarşısını PUBLISH ANINDA alır.
 * `visiting` — WeakSet ilə obyekt-identikliyi əsasında dövrü (circular) referans
 * aşkarlanır (JSON.parse nəticəsi təbii dövrü yarada bilməz, amma proqram
 * daxilində konstruksiya olunmuş obyekt qrafında bu mümkündür — test edilir).
 */
export function validateScoringRule(rule: unknown, ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  walk(rule, ctx, 1, errors, new Set<object>());
  return { valid: errors.length === 0, errors };
}

function walk(
  node: unknown,
  ctx: ValidationContext,
  depth: number,
  errors: string[],
  visiting: Set<object>,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    errors.push(`Nesting depth (${depth}) exceeds maximum allowed (${MAX_NESTING_DEPTH})`);
    return;
  }

  if (typeof node === 'string') {
    if (!ctx.validItemCodes.has(node)) {
      errors.push(`Unknown item reference: "${node}"`);
    }
    return;
  }

  if (!isPlainObject(node)) {
    errors.push('Invalid DSL node: expected an item-code string or a rule object');
    return;
  }

  if (visiting.has(node)) {
    errors.push('Circular reference detected in scoring rule');
    return;
  }
  visiting.add(node);

  const op = node.operation;
  if (typeof op !== 'string' || !ALLOWED_OPERATORS.includes(op as any)) {
    errors.push(`Unknown or disallowed operator: "${String(op)}"`);
    visiting.delete(node);
    return;
  }

  switch (op) {
    case 'SUM':
    case 'AVERAGE':
    case 'COUNT':
    case 'MIN':
    case 'MAX': {
      const operands = (node as any).operands;
      if (!Array.isArray(operands) || operands.length === 0) {
        errors.push(`${op}: "operands" must be a non-empty array`);
        break;
      }
      for (const o of operands) walk(o, ctx, depth + 1, errors, visiting);
      break;
    }
    case 'WEIGHTED_SUM': {
      const operands = (node as any).operands;
      if (!Array.isArray(operands) || operands.length === 0) {
        errors.push('WEIGHTED_SUM: "operands" must be a non-empty array');
        break;
      }
      for (const o of operands) {
        if (!isPlainObject(o) || typeof o.item !== 'string' || typeof o.weight !== 'number' || !Number.isFinite(o.weight)) {
          errors.push('WEIGHTED_SUM: each operand must be { item: string, weight: number }');
          continue;
        }
        if (!ctx.validItemCodes.has(o.item)) {
          errors.push(`Unknown item reference: "${o.item}"`);
        }
      }
      break;
    }
    case 'PERCENTAGE': {
      const max = (node as any).max;
      if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
        errors.push('PERCENTAGE: "max" must be a positive finite number');
      }
      walk((node as any).input, ctx, depth + 1, errors, visiting);
      break;
    }
    case 'THRESHOLD': {
      const bands = (node as any).bands;
      if (!Array.isArray(bands) || bands.length === 0) {
        errors.push('THRESHOLD: "bands" must be a non-empty array');
        break;
      }
      let prevMax = -Infinity;
      bands.forEach((b: any, i: number) => {
        if (!isPlainObject(b) || typeof b.label !== 'string' || b.label.length === 0) {
          errors.push(`THRESHOLD band[${i}]: "label" is required`);
        }
        const isLast = i === bands.length - 1;
        if (!isLast) {
          if (typeof b?.max !== 'number' || !Number.isFinite(b.max)) {
            errors.push(`THRESHOLD band[${i}]: "max" is required (except the last band) and must be a finite number`);
          } else if (b.max <= prevMax) {
            errors.push(`THRESHOLD band[${i}]: "max" must be strictly ascending across bands`);
          } else {
            prevMax = b.max;
          }
        }
      });
      walk((node as any).input, ctx, depth + 1, errors, visiting);
      break;
    }
    case 'SCORE_LOOKUP': {
      const item = (node as any).item;
      const table = (node as any).table;
      if (typeof item !== 'string') {
        errors.push('SCORE_LOOKUP: "item" must be a string');
      } else if (!ctx.validItemCodes.has(item)) {
        errors.push(`Unknown item reference: "${item}"`);
      }
      if (!isPlainObject(table) || Object.keys(table).length === 0) {
        errors.push('SCORE_LOOKUP: "table" must be a non-empty object map');
      } else {
        for (const [k, v] of Object.entries(table)) {
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            errors.push(`SCORE_LOOKUP: table["${k}"] must be a finite number`);
          }
        }
      }
      break;
    }
  }

  visiting.delete(node);
}
