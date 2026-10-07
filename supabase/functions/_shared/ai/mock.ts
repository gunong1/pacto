// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다 — 파일 이름으로 시나리오를 고른다.
// 계약: "근로" → 근로계약, "헬스" → 헬스장 1년권, 그 밖 → 렌탈 계약
// 문서 확인 시나리오 (쪽마다): 음식·강아지·고양이·반려·책상·풍경 → 계약과 무관 / 흐림 → 읽기 어려움 / 특약 → 부속계약 /
//   영수증 → 일반 영수증 / 신분증 → 신분증 / 견적서 → 관련 자료 / 중복 → 앞쪽과 같은 쪽 / 정보부족 → 계약 신호가 거의 없음 /
//   출처불명 → 근거 파일 번호가 빠진 값 (제외 시 다시 분석 확인용)
import { mockDocumentOutput } from './mockFixtures.ts';
import type { ContractFile, ExtractionProvider } from './types.ts';

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    return { model: 'mock', json: mockDocumentOutput(files.map((f) => f.fileName)) };
  }
}
