import { AIConsentRequiredError, AIExtractionError, type AIProvider, type ExtractInput, type ExtractionResult } from '../ai/provider';
import type { PactoSupabase } from './client';

const MESSAGES: Record<string, string> = {
  ai_not_configured: '자동 정리 기능이 아직 준비되지 않았어요. 직접 입력으로 계속해주세요.',
  provider_rate_limited: '요청이 많아 잠시 처리하지 못했어요. 잠시 후 다시 시도해주세요.',
  too_large: '파일이 너무 커서 자동으로 정리하지 못했어요.',
  not_found: '계약서 파일을 찾지 못했어요. 다시 올려주세요.',
  model_refused: '이 문서는 자동으로 정리하지 못했어요. 직접 입력해주세요.',
};

/**
 * 서버(Edge Function 'analyze-contract')를 통한 실제 AI 분석.
 * API 키는 서버에만 있고, 앱은 보관된 원본의 id만 보낸다.
 */
export class SupabaseAIProvider implements AIProvider {
  readonly name = 'server';
  constructor(private readonly sb: PactoSupabase) {}

  async extractContract(input: ExtractInput): Promise<ExtractionResult> {
    const { data, error } = await this.sb.functions.invoke<{ jobId: string; result: ExtractionResult }>('analyze-contract', {
      method: 'POST',
      body: { documentIds: input.documentIds },
    });
    if (error) {
      let code = 'extract_failed';
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') code = ((await ctx.json()) as { error?: string }).error ?? code;
      } catch {
        // 본문 없음
      }
      if (code === 'ai_consent_required') throw new AIConsentRequiredError('ai_consent_required');
      throw new AIExtractionError(MESSAGES[code] ?? '계약서를 자동으로 정리하지 못했어요. 원본은 보관되었으니 직접 입력으로 계속할 수 있어요.');
    }
    if (!data?.result) throw new AIExtractionError('계약서를 자동으로 정리하지 못했어요.');
    return { ...data.result, jobId: data.jobId };
  }

  /** 계약서 자동 정리를 위한 외부 처리 동의 기록 */
  async grantConsent(): Promise<void> {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) throw new AIExtractionError('로그인이 필요해요.');
    const { error } = await this.sb.from('profiles').update({ ai_processing_agreed_at: new Date().toISOString() }).eq('id', auth.user.id);
    if (error) throw new AIExtractionError('동의를 저장하지 못했어요. 다시 시도해주세요.');
  }
}
