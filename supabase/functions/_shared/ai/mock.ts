// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다 — 파일 이름으로 시나리오를 고른다.
// 계약: "근로" → 근로계약, "헬스" → 헬스장 1년권, "할인" → 할인 붙은 렌탈, 그 밖 → 렌탈 계약
// 문서 확인 시나리오 (쪽마다): 음식·강아지·고양이·반려·책상·풍경 → 계약과 무관 / 흐림 → 읽기 어려움 / 특약 → 부속계약 /
//   영수증 → 일반 영수증 / 신분증 → 신분증 / 견적서 → 관련 자료 / 중복 → 앞쪽과 같은 쪽 / 정보부족 → 계약 신호가 거의 없음 /
//   출처불명 → 근거 파일 번호가 빠진 값 (제외 시 다시 분석 확인용)
import { mockDocumentOutput } from './mockFixtures.ts';
import type { ContractFile, ExtractionProvider } from './types.ts';

/**
 * 테스트 확인용: AI에 실제로 보낸 파일의 SHA-256과 암호 여부 (내용·텍스트는 남기지 않음).
 * 통합 테스트가 "암호 PDF는 원본이 아니라 보호본(또는 메모리 복호화 사본)을 보냈는지" 확인한다. mock에서만 붙는다.
 */
function hasBytes(hay: Uint8Array, text: string): boolean {
  const n = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

async function inputDigest(files: ContractFile[]) {
  return await Promise.all(
    files.map(async (f) => {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      // 트레일러의 /Encrypt (암호 PDF) — 바이트에서 찾기만
      const encrypted = f.mimeType === 'application/pdf' && hasBytes(bytes, '/Encrypt');
      return { sha256, encrypted, mimeType: f.mimeType };
    }),
  );
}

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    return { model: 'mock', json: { ...mockDocumentOutput(files.map((f) => f.fileName)), _mock_input: await inputDigest(files) } };
  }
}
