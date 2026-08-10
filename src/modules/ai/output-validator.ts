/**
 * STRUCTURED OUTPUT VALIDATION + SAFETY VALIDATION + GROUNDING
 * (Faz 3.14 Phase 6/7, Faz 3.1 Fix#5 pipeline-ının SCHEMA VALIDATION →
 * SAFETY VALIDATION → FACT/SOURCE ATTRIBUTION addımları).
 */

export interface ParsedClaim {
  claim: string;
  source_type: 'assessment' | 'session' | 'goal' | 'plan' | 'report';
  source_id: string;
  source_field: string | null;
}

export interface ParsedAIOutput {
  summary: string;
  claims: ParsedClaim[];
}

export interface ValidationResult {
  valid: boolean;       // struktur/grounding baxımından etibarlıdırmı (FALSE-dursa DB-yə YAZILMIR)
  errors: string[];     // hard-fail səbəbləri (malformed JSON, naməlum sahə, uydurma referans)
  safetyFlags: string[]; // soft-fail (struktur düzgündür, AMMA FLAGGED statuslu yazılmalıdır)
  parsed?: ParsedAIOutput;
}

const ALLOWED_SOURCE_TYPES = ['assessment', 'session', 'goal', 'plan', 'report'];
const ALLOWED_TOP_LEVEL_KEYS = ['summary', 'claims'];

// Faz 3.1 bənd 27/53: AI "mütləq", "dəqiq diaqnoz", "labüd" kimi qəti klinik
// ifadələr işlətməməlidir — pattern-səviyyəli, siyahı-əsaslı yoxlama.
const UNSAFE_PATTERNS = [/mütləq/i, /labüd/i, /dəqiq diaqnoz/i, /qəti diaqnoz/i, /kəsinliklə/i];

/** JSON parse + schema (yalnız icazəli sahələr) + safety + source-grounding. */
export function validateAIOutput(
  rawOutput: string,
  availableSourceIds: Set<string>, // `${type}:${id}` formatında, context-də mövcud olanlar
): ValidationResult {
  const errors: string[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return { valid: false, errors: ['Malformed JSON — parse edilə bilmədi'], safetyFlags: [] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['Output kök səviyyədə object olmalıdır'], safetyFlags: [] };
  }

  const unknownKeys = Object.keys(parsed).filter((k) => !ALLOWED_TOP_LEVEL_KEYS.includes(k));
  if (unknownKeys.length > 0) {
    errors.push(`Naməlum sahə(lər) (schema icazə vermir): ${unknownKeys.join(', ')}`);
  }

  if (typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
    errors.push('"summary" string olmalı və boş olmamalıdır');
  }

  if (!Array.isArray(parsed.claims)) {
    errors.push('"claims" array olmalıdır');
  } else {
    parsed.claims.forEach((c: any, i: number) => {
      if (typeof c.claim !== 'string' || !c.claim) errors.push(`claims[${i}].claim string olmalıdır`);
      if (!ALLOWED_SOURCE_TYPES.includes(c.source_type)) {
        errors.push(`claims[${i}].source_type icazəli deyil: ${c.source_type}`);
      }
      if (typeof c.source_id !== 'string' || !c.source_id) {
        errors.push(`claims[${i}].source_id string olmalıdır`);
      } else if (!availableSourceIds.has(`${c.source_type}:${c.source_id}`)) {
        // GROUNDING: AI YALNIZ context-də faktiki mövcud olan mənbələrə istinad edə bilər.
        errors.push(`claims[${i}]: source (${c.source_type}:${c.source_id}) context-də mövcud deyil — uydurma referans`);
      }
    });
  }

  // SAFETY VALIDATION (soft-fail — struktur etibarlıdırsa belə FLAGGED səbəbi kimi qeyd olunur)
  const safetyFlags: string[] = [];
  if (typeof parsed.summary === 'string') {
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(parsed.summary)) {
        safetyFlags.push(`Qadağan olunmuş klinik ifadə aşkarlandı ("${pattern.source}")`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, safetyFlags };
  }

  return {
    valid: true,
    errors: [],
    safetyFlags,
    parsed: { summary: parsed.summary, claims: parsed.claims },
  };
}
