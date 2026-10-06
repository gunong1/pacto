// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다.
// 파일 이름에 "근로"가 있으면 근로계약 예시, "헬스"가 있으면 헬스장 1년권 예시, 아니면 렌탈 계약 예시로 응답한다.
import { employmentOutput, gymYearOutput, rentalOutput } from './mockFixtures.ts';
import type { ContractFile, ExtractionProvider } from './types.ts';

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    const name = files[0]?.fileName ?? '';
    const title = name.replace(/\.[^.]+$/, '') || '계약서';
    return { model: 'mock', json: /근로/.test(name) ? employmentOutput(title) : /헬스/.test(name) ? gymYearOutput(title) : rentalOutput(title) };
  }
}
