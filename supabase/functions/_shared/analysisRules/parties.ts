// 규칙: 계약 당사자 (parties)
// 목적: AI가 계약서에서 찾은 당사자를 계약 종류의 역할(레지스트리 PARTY_ROLE_DEFS)로 정리한다.
// 입력: 모델 출력 parties [{role, name, confidence, evidence_*}], 계약 종류
// 출력: ExtractedParty[] — 계약서에 이름이 있는 당사자만. 없는 당사자를 만들지 않는다 (빠진 쪽은 화면이 "확인 필요"로 보여줌)
//   - 모르는 역할 코드 → party(당사자). 다른 종류의 역할(렌탈로 분류된 계약의 임대인 등)은 계약서가 밝힌 대로 둔다
//   - 같은 역할·같은 이름은 하나로 / 근거 문장이 없으면 신뢰도 low
//   - 사용자가 어느 쪽인지는 여기서 정하지 않는다 (사용자가 고를 때만)
// 예: lease + [{lessor 김민수}, {lessee 박지훈}, {lessee 이수진}] → 임대인 1 · 임차인 2
//   - 예전 당사자 칸(details: 임대인·임차인·근로자)에 온 이름은 그 역할이 parties에 없을 때만 그 역할로 (칸 이름이 곧 역할 — 추측 아님)
// 테스트: src/domain/__tests__/golden/parties.test.ts
import { DETAIL_FIELD_DEFS, partyRoleDef } from '../contractRegistry.ts';
import type { ExtractedDetail, ExtractedParty } from './types.ts';
import { confidenceOf, isObj, quoteOf, text } from './values.ts';

export const MAX_PARTIES = 20;
/** 이름이 아닌 값 (빈칸 표시·서명란) */
const NOT_A_NAME = /^(?:\(?\s*(?:인|서명|날인|성명|이름|미기재|없음|-|_+|\.+)\s*\)?)$/;

export function cleanParties(raw: unknown, kind: string): ExtractedParty[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedParty[] = [];
  for (const p of raw) {
    if (!isObj(p)) continue;
    const name = text(p.name, 100);
    if (!name || NOT_A_NAME.test(name)) continue;
    const role = partyRoleDef(kind, typeof p.role === 'string' ? p.role : null).code;
    if (out.some((x) => x.role === role && x.name.replace(/\s/g, '') === name.replace(/\s/g, ''))) continue;
    const ev = quoteOf(p);
    out.push({ role, name, confidence: ev.evidence ? confidenceOf(p.confidence) : 'low', ...ev });
    if (out.length >= MAX_PARTIES) break;
  }
  return out;
}

/** 예전 당사자 칸(details.landlord · tenant · employee_name)에 온 이름 → 그 역할의 당사자 (parties에 그 역할이 없을 때만) */
export function partiesFromDetails(parties: ExtractedParty[], details: Record<string, ExtractedDetail>, profile: string): void {
  for (const def of DETAIL_FIELD_DEFS) {
    if (!def.party || def.type !== profile || parties.some((p) => p.role === def.party)) continue;
    const d = details[def.db];
    const name = typeof d?.value === 'string' ? text(d.value, 100) : null;
    if (!name || NOT_A_NAME.test(name) || parties.length >= MAX_PARTIES) continue;
    parties.push({ role: def.party, name, confidence: d.evidence?.length ? d.confidence : 'low', ...(d.evidence ? { evidence: d.evidence } : {}) });
  }
}
