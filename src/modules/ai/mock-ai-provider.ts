import { AIGenerationRequest, AIGenerationResponse, AIProvider, AIProviderTimeoutError, AIProviderUnavailableError } from './ai-provider.interface';

export type MockMode = 'success' | 'malformed_json' | 'unknown_field' | 'timeout' | 'unavailable' | 'unsafe_language';

/**
 * Deterministik, YALNIZ test/development məqsədli provider (Faz 3.14 Phase 5).
 * Real LLM provider inteqrasiyası bu fazın scope-unda DEYİL (frozen
 * specification-da konkret provider seçilməyib — uydurulmadı).
 *
 * Prompt injection qorunması (Phase 11): bu provider `request.context`-i
 * HEÇ VAXT "instruction" kimi şərh etmir — yalnız içindən əvvəlcədən bilinən
 * sahələri (məs. "sourceIds") mexaniki olaraq oxuyur və output-a köçürür.
 * Context daxilindəki HƏR HANSI mətn (o cümlədən "Ignore previous
 * instructions..." kimi cəhdlər) sadəcə DATA kimi qalır, davranışı dəyişmir.
 */
export class MockAIProvider implements AIProvider {
  constructor(private mode: MockMode = 'success') {}

  async generate(request: AIGenerationRequest): Promise<AIGenerationResponse> {
    if (this.mode === 'timeout') {
      throw new AIProviderTimeoutError('Mock provider: timeout simulyasiyası');
    }
    if (this.mode === 'unavailable') {
      throw new AIProviderUnavailableError('Mock provider: unavailable simulyasiyası');
    }
    if (this.mode === 'malformed_json') {
      return { rawOutput: '{ "summary": "natamam json', modelVersion: 'mock-v1' };
    }
    if (this.mode === 'unknown_field') {
      return {
        rawOutput: JSON.stringify({ summary: 'Test', unknown_clinical_field: 'uydurulmuş dəyər', claims: [] }),
        modelVersion: 'mock-v1',
      };
    }
    if (this.mode === 'unsafe_language') {
      return {
        rawOutput: JSON.stringify({
          summary: 'Uşağa mütləq bu diaqnoz qoyulmalıdır və dəqiq müalicə tələb olunur.',
          claims: [],
        }),
        modelVersion: 'mock-v1',
      };
    }

    // 'success' — YALNIZ context-də verilmiş mənbə ID-lərinə istinad edən,
    // mexaniki generasiya olunmuş claim-lər (heç bir fakt uydurulmur).
    const sourceIds = (request.context.availableSourceIds as Array<{ type: string; id: string; field?: string }>) ?? [];
    const claims = sourceIds.slice(0, 3).map((s) => ({
      claim: `Mövcud ${s.type} məlumatına əsasən qeyd.`,
      source_type: s.type,
      source_id: s.id,
      source_field: s.field ?? null,
    }));

    const hasEnoughData = sourceIds.length > 0;
    const summary = hasEnoughData
      ? `Mövcud ${sourceIds.length} mənbə əsasında struktur xülasə (task: ${request.task}).`
      : 'Mövcud məlumat bu nəticəni çıxarmaq üçün kifayət deyil.';

    return {
      rawOutput: JSON.stringify({ summary, claims }),
      modelVersion: 'mock-v1',
    };
  }
}
