import { AIConsentRequiredError, AIExtractionError, type AIProvider, type AnalysisChoice, type AnalysisOutcome, type ExtractInput } from '../ai/provider';
import type { PactoSupabase } from './client';

const MESSAGES: Record<string, string> = {
  ai_not_configured: '자동 정리 기능이 아직 준비되지 않았어요. 직접 입력으로 계속해주세요.',
  provider_rate_limited: '요청이 많아 잠시 처리하지 못했어요. 잠시 후 다시 시도해주세요.',
  too_large: '파일이 너무 커서 자동으로 정리하지 못했어요.',
  not_found: '계약서 파일을 찾지 못했어요. 다시 올려주세요.',
  model_refused: '이 문서는 자동으로 정리하지 못했어요. 직접 입력해주세요.',
  confirmation_required: '계약 관련 문서인지 먼저 확인해주세요.',
  not_allowed: '이 파일은 계약서로 확인되지 않아 정리할 수 없어요.',
  password_required: '비밀번호가 설정된 계약서예요. PDF 비밀번호를 입력한 뒤 다시 시도해주세요.',
  invalid_password: '비밀번호가 맞지 않아요.\n다시 확인해주세요.',
  protection_required: '민감정보 보호를 마치지 못한 암호 PDF는 자동으로 정리하지 않아요. 직접 입력으로 계속할 수 있어요.',
};

/** 암호 PDF 비밀번호 — 있을 때만 body에 (주소에는 넣지 않는다) */
const passwordsBody = (input: ExtractInput) => (input.passwords && Object.keys(input.passwords).length ? { passwords: input.passwords } : {});

/**
 * 서버(Edge Function 'analyze-contract')를 통한 실제 AI 분석.
 * API 키는 서버에만 있고, 앱은 보관된 원본의 id만 보낸다.
 */
export class SupabaseAIProvider implements AIProvider {
  readonly name = 'server';
  constructor(private readonly sb: PactoSupabase) {}

  async analyze(input: ExtractInput): Promise<AnalysisOutcome> {
    return await this.call({ documentIds: input.documentIds, ...passwordsBody(input) });
  }

  async finalize(jobId: string | undefined, choice: AnalysisChoice, input?: ExtractInput): Promise<AnalysisOutcome> {
    if (!jobId) throw new AIExtractionError('분석 기록을 찾지 못했어요. 다시 시도해주세요.');
    // 다시 분석이 필요하면 서버가 암호 PDF를 다시 열어야 할 수 있어 비밀번호를 함께 (POST body)
    return await this.call({ jobId, ...choice, ...(input ? passwordsBody(input) : {}) });
  }

  private async call(body: Record<string, unknown>): Promise<AnalysisOutcome> {
    const { data, error } = await this.sb.functions.invoke<AnalysisOutcome & { jobId: string }>('analyze-contract', { method: 'POST', body });
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
    if (!data?.validation) throw new AIExtractionError('계약서를 자동으로 정리하지 못했어요.');
    return { ...data, result: data.result ? { ...data.result, jobId: data.jobId } : null };
  }

  /** 계약서 자동 정리를 위한 외부 처리 동의 기록 */
  async grantConsent(): Promise<void> {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) throw new AIExtractionError('로그인이 필요해요.');
    const { error } = await this.sb.from('profiles').update({ ai_processing_agreed_at: new Date().toISOString() }).eq('id', auth.user.id);
    if (error) throw new AIExtractionError('동의를 저장하지 못했어요. 다시 시도해주세요.');
  }
}
