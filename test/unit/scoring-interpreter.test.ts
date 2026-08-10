import { evaluateSubscaleRule } from '../../src/modules/assessments/scoring-interpreter';
import { ScoringRule } from '../../src/modules/assessments/scoring-dsl.types';

describe('Faz 3.4 — Scoring Interpreter (pure, unit)', () => {
  test('TEST 20: SUM düzgün hesablanır', () => {
    const rule: ScoringRule = { operation: 'SUM', operands: ['Q1', 'Q2', 'Q3'] };
    const out = evaluateSubscaleRule(rule, { Q1: 2, Q2: 3, Q3: 5 });
    expect(out.rawScore).toBe(10);
    expect(out.interpretedResult).toBeNull();
  });

  test('TEST 21: AVERAGE düzgün hesablanır', () => {
    const rule: ScoringRule = { operation: 'AVERAGE', operands: ['Q1', 'Q2', 'Q3', 'Q4'] };
    const out = evaluateSubscaleRule(rule, { Q1: 2, Q2: 4, Q3: 6, Q4: 8 });
    expect(out.rawScore).toBe(5);
  });

  test('TEST 22: WEIGHTED_SUM düzgün hesablanır', () => {
    const rule: ScoringRule = {
      operation: 'WEIGHTED_SUM',
      operands: [
        { item: 'Q1', weight: 2 },
        { item: 'Q2', weight: 1 },
      ],
    };
    const out = evaluateSubscaleRule(rule, { Q1: 3, Q2: 4 }); // 3*2 + 4*1 = 10
    expect(out.rawScore).toBe(10);
  });

  test('TEST 23: THRESHOLD düzgün band qaytarır', () => {
    const rule: ScoringRule = {
      operation: 'THRESHOLD',
      input: { operation: 'SUM', operands: ['Q1', 'Q2', 'Q3'] },
      bands: [
        { max: 5, label: 'Aşağı' },
        { max: 10, label: 'Orta' },
        { label: 'Yüksək' }, // son band, max yoxdur
      ],
    };
    expect(evaluateSubscaleRule(rule, { Q1: 1, Q2: 1, Q3: 1 }).interpretedResult).toBe('Aşağı'); // sum=3
    expect(evaluateSubscaleRule(rule, { Q1: 3, Q2: 3, Q3: 3 }).interpretedResult).toBe('Orta'); // sum=9
    expect(evaluateSubscaleRule(rule, { Q1: 10, Q2: 10, Q3: 10 }).interpretedResult).toBe('Yüksək'); // sum=30
  });

  test('TEST 24: SCORE_LOOKUP düzgün nəticə qaytarır', () => {
    const rule: ScoringRule = {
      operation: 'SCORE_LOOKUP',
      item: 'Q1',
      table: { low: 1, medium: 2, high: 3 },
    };
    const out = evaluateSubscaleRule(rule, { Q1: 'medium' });
    expect(out.rawScore).toBe(2);
    expect(out.interpretedResult).toBe('medium');
  });

  test('Əlavə: COUNT düzgün hesablanır (endorsed item sayı)', () => {
    const rule: ScoringRule = { operation: 'COUNT', operands: ['Q1', 'Q2', 'Q3'] };
    const out = evaluateSubscaleRule(rule, { Q1: 1, Q2: 0, Q3: true });
    expect(out.rawScore).toBe(2); // Q1(1>0) + Q3(true→1>0), Q2(0) sayılmır
  });

  test('Əlavə: MIN/MAX düzgün hesablanır', () => {
    expect(evaluateSubscaleRule({ operation: 'MIN', operands: ['Q1', 'Q2'] }, { Q1: 5, Q2: 2 }).rawScore).toBe(2);
    expect(evaluateSubscaleRule({ operation: 'MAX', operands: ['Q1', 'Q2'] }, { Q1: 5, Q2: 2 }).rawScore).toBe(5);
  });

  test('Əlavə: PERCENTAGE düzgün hesablanır', () => {
    const rule: ScoringRule = { operation: 'PERCENTAGE', input: { operation: 'SUM', operands: ['Q1', 'Q2'] }, max: 20 };
    const out = evaluateSubscaleRule(rule, { Q1: 5, Q2: 5 }); // (10/20)*100 = 50
    expect(out.rawScore).toBe(50);
  });

  test('Əlavə: nested operand-lar (SUM daxilində AVERAGE) düzgün hesablanır', () => {
    const rule: ScoringRule = {
      operation: 'SUM',
      operands: ['Q1', { operation: 'AVERAGE', operands: ['Q2', 'Q3'] }],
    };
    const out = evaluateSubscaleRule(rule, { Q1: 10, Q2: 4, Q3: 6 }); // 10 + avg(4,6)=5 => 15
    expect(out.rawScore).toBe(15);
  });

  test('Determinizm: eyni input həmişə eyni nəticə verir', () => {
    const rule: ScoringRule = { operation: 'SUM', operands: ['Q1', 'Q2'] };
    const answers = { Q1: 3, Q2: 4 };
    const r1 = evaluateSubscaleRule(rule, answers);
    const r2 = evaluateSubscaleRule(rule, answers);
    expect(r1).toEqual(r2);
  });
});
