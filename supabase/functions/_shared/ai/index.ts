import { MockExtractionProvider } from './mock.ts';
import { OpenAIProvider } from './openai.ts';
import { type ExtractionProvider, ProviderError } from './types.ts';

/**
 * 공급자 선택 (Edge Function secrets):
 *   AI_PROVIDER=openai, OPENAI_API_KEY=..., OPENAI_MODEL=(선택, 기본 gpt-5.4-mini)
 *   AI_PROVIDER=mock (로컬 테스트)
 * Gemini/Claude는 같은 ExtractionProvider 인터페이스로 추가한다.
 */
export function selectProvider(): ExtractionProvider {
  const name = (Deno.env.get('AI_PROVIDER') ?? 'openai').toLowerCase();
  if (name === 'mock') return new MockExtractionProvider();
  if (name === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new ProviderError('ai_not_configured');
    return new OpenAIProvider(key, Deno.env.get('OPENAI_MODEL') || 'gpt-5.4-mini');
  }
  throw new ProviderError('ai_not_configured');
}
