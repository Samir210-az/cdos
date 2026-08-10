/**
 * DECLARATIVE SCORING DSL — Faz 3.1 CRITICAL FIX #6 / Faz 3.4 bənd 6.
 * Yalnız bu faylda təsvir olunan strukturlar icazəlidir. Heç bir yerdə
 * eval/Function()/dynamic code execution istifadə edilmir.
 */

export type ScoringOperator =
  | 'SUM'
  | 'AVERAGE'
  | 'WEIGHTED_SUM'
  | 'COUNT'
  | 'PERCENTAGE'
  | 'MIN'
  | 'MAX'
  | 'THRESHOLD'
  | 'SCORE_LOOKUP';

export const ALLOWED_OPERATORS: ScoringOperator[] = [
  'SUM',
  'AVERAGE',
  'WEIGHTED_SUM',
  'COUNT',
  'PERCENTAGE',
  'MIN',
  'MAX',
  'THRESHOLD',
  'SCORE_LOOKUP',
];

export const MAX_NESTING_DEPTH = 5;

/** Operand ya birbaşa item "code"-dur (leaf), ya da nested rule (nesting dəstəyi). */
export type Operand = string | ScoringRule;

export interface WeightedOperand {
  item: string;
  weight: number;
}

export interface SumRule {
  operation: 'SUM';
  operands: Operand[];
}
export interface AverageRule {
  operation: 'AVERAGE';
  operands: Operand[];
}
export interface CountRule {
  operation: 'COUNT';
  operands: Operand[];
}
export interface MinRule {
  operation: 'MIN';
  operands: Operand[];
}
export interface MaxRule {
  operation: 'MAX';
  operands: Operand[];
}
export interface WeightedSumRule {
  operation: 'WEIGHTED_SUM';
  operands: WeightedOperand[];
}
export interface PercentageRule {
  operation: 'PERCENTAGE';
  input: Operand;
  max: number;
}
export interface ThresholdBand {
  /** Son band üçün max buraxıla bilər (yuxarı sərhədsiz, "əks halda" mənasında). */
  max?: number;
  label: string;
}
export interface ThresholdRule {
  operation: 'THRESHOLD';
  input: Operand;
  bands: ThresholdBand[];
}
export interface ScoreLookupRule {
  operation: 'SCORE_LOOKUP';
  item: string;
  table: Record<string, number>;
}

export type ScoringRule =
  | SumRule
  | AverageRule
  | CountRule
  | MinRule
  | MaxRule
  | WeightedSumRule
  | PercentageRule
  | ThresholdRule
  | ScoreLookupRule;

export interface ScoringOutput {
  rawScore: number;
  interpretedResult: string | null;
}
