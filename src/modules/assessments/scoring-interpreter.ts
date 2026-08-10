import { Operand, ScoringOutput, ScoringRule } from './scoring-dsl.types';

/**
 * PURE INTERPRETER — Faz 3.4 bənd 10.
 * DB-yə yazmır, HTTP çağırmır, LLM çağırmır, dynamic code icra etmir,
 * global state istifadə etmir. Eyni input → həmişə eyni output.
 *
 * QEYD: bu funksiya YALNIZ əvvəlcədən `validateScoringRule` ilə doğrulanmış
 * DSL üzərində işlədilməlidir (publish-time validasiyadan keçməmiş sərbəst
 * istifadəçi input-u BURAYA ötürülmür).
 */

type AnswerMap = Record<string, unknown>;

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function evaluateNumeric(node: Operand, answers: AnswerMap): number {
  if (typeof node === 'string') {
    return toNumber(answers[node]);
  }
  switch (node.operation) {
    case 'SUM':
      return node.operands.reduce((sum, o) => sum + evaluateNumeric(o, answers), 0);
    case 'AVERAGE': {
      const vals = node.operands.map((o) => evaluateNumeric(o, answers));
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    case 'COUNT':
      // "endorsed" say: > 0 (numeric) və ya true (boolean truthy → toNumber=1) olan operand-lar
      return node.operands.filter((o) => evaluateNumeric(o, answers) > 0).length;
    case 'MIN':
      return Math.min(...node.operands.map((o) => evaluateNumeric(o, answers)));
    case 'MAX':
      return Math.max(...node.operands.map((o) => evaluateNumeric(o, answers)));
    case 'WEIGHTED_SUM':
      return node.operands.reduce((sum, o) => sum + toNumber(answers[o.item]) * o.weight, 0);
    case 'PERCENTAGE':
      return (evaluateNumeric(node.input, answers) / node.max) * 100;
    case 'THRESHOLD':
      // nested kontekstdə THRESHOLD-un ƏDƏDİ dəyəri = input-un ədədi dəyəridir
      // (kateqorial label yalnız top-level çağırışda təyin olunur, bax evaluateSubscaleRule)
      return evaluateNumeric(node.input, answers);
    case 'SCORE_LOOKUP': {
      const raw = answers[node.item];
      const key = String(raw);
      return node.table[key] ?? 0;
    }
    default:
      // Whitelist-dən kənar operator BURAYA çatmamalıdır (publish-time validasiya
      // bunu artıq rədd edib) — dəqiqlik üçün 0 qaytarılır, exception atılmır
      // (pure funksiya, runtime-da sürprizsiz davranış).
      return 0;
  }
}

/** Top-level giriş nöqtəsi — bir subscale-in tam nəticəsini (rawScore + interpretedResult) qaytarır. */
export function evaluateSubscaleRule(rule: ScoringRule, answers: AnswerMap): ScoringOutput {
  if (rule.operation === 'THRESHOLD') {
    const value = evaluateNumeric(rule.input, answers);
    for (const band of rule.bands) {
      if (band.max === undefined || value <= band.max) {
        return { rawScore: value, interpretedResult: band.label };
      }
    }
    // nəzəri olaraq bura çatılmamalıdır (validator son band-ı açıq buraxmağı tələb edir),
    // amma pure funksiya heç vaxt exception atmır — ən son band-a düşür.
    const last = rule.bands[rule.bands.length - 1];
    return { rawScore: value, interpretedResult: last ? last.label : null };
  }

  if (rule.operation === 'SCORE_LOOKUP') {
    const raw = answers[rule.item];
    const key = String(raw);
    const score = rule.table[key] ?? 0;
    return { rawScore: score, interpretedResult: key in rule.table ? key : null };
  }

  return { rawScore: evaluateNumeric(rule, answers), interpretedResult: null };
}
