// OpenAI Responses API — PDF(input_file)·사진(input_image) 직접 입력 + Structured Outputs(json_schema, strict)
// store: false → OpenAI 측에 응답을 저장하지 않도록 요청
import { extractionInstructions, extractionJsonSchema } from '../extraction.ts';
import { type ContractFile, type ExtractionProvider, ProviderError } from './types.ts';

export function buildOpenAIRequest(model: string, files: ContractFile[], today: string) {
  const content: unknown[] = files.map((f) =>
    f.mimeType === 'application/pdf'
      ? { type: 'input_file', filename: f.fileName, file_data: `data:application/pdf;base64,${f.base64}` }
      : { type: 'input_image', image_url: `data:${f.mimeType};base64,${f.base64}`, detail: 'high' },
  );
  content.push({ type: 'input_text', text: files.length > 1 ? `위 ${files.length}개 파일은 한 계약서의 여러 쪽입니다. 순서대로 1쪽부터입니다.` : '위 계약서를 정리해주세요.' });
  return {
    model,
    instructions: extractionInstructions(today),
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'contract_extraction', schema: extractionJsonSchema(), strict: true } },
    store: false,
  };
}

/** Responses API 응답에서 output_text 추출 (REST 응답에는 SDK의 output_text 편의 속성이 없을 수 있음) */
export function readOutputText(body: unknown): string {
  const b = body as { output_text?: string; output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[] };
  if (typeof b.output_text === 'string' && b.output_text) return b.output_text;
  for (const item of b.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') throw new ProviderError('model_refused');
      if (c.type === 'output_text' && c.text) return c.text;
    }
  }
  throw new ProviderError('empty_output');
}

export class OpenAIProvider implements ExtractionProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async extract(files: ContractFile[], today: string) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOpenAIRequest(this.model, files, today)),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      // 응답 본문(계약서 내용이 섞일 수 있음)은 로그에 남기지 않고 상태 코드만 전달
      throw new ProviderError(res.status === 401 ? 'provider_auth' : res.status === 429 ? 'provider_rate_limited' : `provider_http_${res.status}`);
    }
    const text = readOutputText(await res.json());
    try {
      return { json: JSON.parse(text), model: this.model };
    } catch {
      throw new ProviderError('invalid_json');
    }
  }
}
