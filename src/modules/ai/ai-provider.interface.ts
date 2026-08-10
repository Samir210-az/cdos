/**
 * Faz 3.14 Phase 5: konkret AI provider (OpenAI/OpenRouter/s.) frozen
 * specification-da MÜƏYYƏN EDİLMƏYİB — provider adı/API key sistemi
 * UYDURULMUR. Bunun əvəzinə YALNIZ interfeys + deterministik test provider.
 */
export interface AIGenerationRequest {
  systemInstruction: string;
  context: Record<string, unknown>; // strukturlaşdırılmış, DATA kimi ötürülür (bax Phase 11 — prompt injection qorunması)
  task: string;
  outputSchemaHint: string;
}

export interface AIGenerationResponse {
  rawOutput: string; // JSON string — schema-validator.ts tərəfindən doğrulanır
  modelVersion: string;
}

export class AIProviderTimeoutError extends Error {}
export class AIProviderUnavailableError extends Error {}

export interface AIProvider {
  generate(request: AIGenerationRequest): Promise<AIGenerationResponse>;
}
