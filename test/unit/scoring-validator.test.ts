import { validateScoringRule } from '../../src/modules/assessments/scoring-validator';

describe('Faz 3.4 — Scoring DSL Validator (publish-time security)', () => {
  const validItemCodes = new Set(['Q1', 'Q2', 'Q3']);

  test('TEST 10: naməlum operator rədd olunur', () => {
    const rule = { operation: 'EXEC_SHELL', operands: ['Q1'] };
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /Unknown or disallowed operator/.test(e))).toBe(true);
  });

  test('TEST 11: nesting depth 5-dən çox olduqda rədd olunur', () => {
    let rule: any = 'Q1';
    for (let i = 0; i < 6; i++) {
      rule = { operation: 'SUM', operands: [rule] };
    }
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /Nesting depth/.test(e))).toBe(true);
  });

  test('nesting depth = 5 (limit daxilində) qəbul olunur', () => {
    let rule: any = 'Q1';
    for (let i = 0; i < 4; i++) {
      rule = { operation: 'SUM', operands: [rule] };
    }
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(true);
  });

  test('TEST 12: mövcud olmayan item referansı rədd olunur', () => {
    const rule = { operation: 'SUM', operands: ['Q1', 'Q99'] };
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /Unknown item reference: "Q99"/.test(e))).toBe(true);
  });

  test('TEST 13: dövrü (circular) referans aşkarlanır', () => {
    const rule: any = { operation: 'SUM', operands: [] };
    rule.operands.push(rule);
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /Circular reference/.test(e))).toBe(true);
  });

  test('TEST 14: DSL heç bir halda eval/Function() istifadə etmir (mənbə kodu yoxlaması)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const interpreterSrc = fs.readFileSync(
      require.resolve('../../src/modules/assessments/scoring-interpreter.ts'),
      'utf8',
    );
    const validatorSrc = fs.readFileSync(
      require.resolve('../../src/modules/assessments/scoring-validator.ts'),
      'utf8',
    );
    expect(interpreterSrc).not.toMatch(/\beval\s*\(/);
    expect(interpreterSrc).not.toMatch(/new Function\s*\(/);
    expect(validatorSrc).not.toMatch(/\beval\s*\(/);
    expect(validatorSrc).not.toMatch(/new Function\s*\(/);
  });

  test('WEIGHTED_SUM: yanlış weight tipi rədd olunur', () => {
    const rule = { operation: 'WEIGHTED_SUM', operands: [{ item: 'Q1', weight: 'iki' }] };
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
  });

  test('THRESHOLD: azalan (qeyri-ardıcıl) band max-ları rədd olunur', () => {
    const rule = {
      operation: 'THRESHOLD',
      input: 'Q1',
      bands: [
        { max: 10, label: 'A' },
        { max: 5, label: 'B' },
        { label: 'C' },
      ],
    };
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(false);
  });

  test('Düzgün, mürəkkəb DSL qəbul olunur (bütün operandlar keçərli)', () => {
    const rule = {
      operation: 'THRESHOLD',
      input: { operation: 'WEIGHTED_SUM', operands: [{ item: 'Q1', weight: 2 }, { item: 'Q2', weight: 1 }] },
      bands: [
        { max: 10, label: 'Aşağı' },
        { label: 'Yüksək' },
      ],
    };
    const res = validateScoringRule(rule, { validItemCodes });
    expect(res.valid).toBe(true);
  });
});
