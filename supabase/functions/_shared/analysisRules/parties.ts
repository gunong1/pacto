// 규칙: 계약 당사자 (parties)
// 목적: AI가 계약서에서 찾은 당사자를 계약 종류의 역할(레지스트리 PARTY_ROLE_DEFS)로 정리한다.
// 입력: 모델 출력 parties [{role, name, confidence, evidence_*}], 계약 종류
// 출력: ExtractedParty[] — 계약서에 이름이 있는 당사자만. 없는 당사자를 만들지 않는다 (빠진 쪽은 화면이 "확인 필요"로 보여줌)
//   - 모르는 역할 코드 → party(당사자). 다른 종류의 역할(렌탈로 분류된 계약의 임대인 등)은 계약서가 밝힌 대로 둔다
//   - 같은 역할·같은 이름은 하나로 / 근거 문장이 없으면 신뢰도 low
//   - 사용자가 어느 쪽인지는 여기서 정하지 않는다 (사용자가 고를 때만)
// 예: lease + [{lessor 김민수}, {lessee 박지훈}, {lessee 이수진}] → 임대인 1 · 임차인 2
//   - 예전 당사자 칸(details: 임대인·임차인·근로자)에 온 이름은 그 역할이 parties에 없을 때만 그 역할로 (칸 이름이 곧 역할 — 추측 아님)
//   - 계약서 용어가 계약 종류의 역할과 다르면 같은 자리로 연결 (렌탈 계약서의 임대인 → 렌탈회사, term="임대인") — 레지스트리 normalizePartyRoles
//     그 자리에 다른 이름이 있으면 바꾸지 않는다 (앱이 확인 필요로 보여줌)
//   - 법인명 뒤의 대표자("주식회사 A / 대표 B")는 대표자(representative)로 따로 — 법인과 대표자를 같은 당사자로 보지 않음
// 테스트: src/domain/__tests__/golden/parties.test.ts · party-roles.test.ts
import { DETAIL_FIELD_DEFS, normalizePartyRoles, partyRoleDef, samePartyName, splitRepresentative } from '../contractRegistry.ts';
import type { ExtractedDetail, ExtractedParty } from './types.ts';
import { confidenceOf, isObj, quoteOf, text } from './values.ts';

export const MAX_PARTIES = 20;
/** 이름이 아닌 값 (빈칸 표시·서명란) */
const NOT_A_NAME = /^(?:\(?\s*(?:인|서명|날인|성명|이름|미기재|없음|-|_+|\.+)\s*\)?)$/;

export function cleanParties(raw: unknown, kind: string, details: Record<string, ExtractedDetail> = {}, profile = ''): { parties: ExtractedParty[]; roleMap: Record<string, string>; conflicts: string[] } {
  const out: ExtractedParty[] = [];
  const reps: ExtractedParty[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!isObj(p)) continue;
    const full = text(p.name, 100);
    if (!full || NOT_A_NAME.test(full)) continue;
    const split = splitRepresentative(full);
    const name = split.name;
    const role = partyRoleDef(kind, typeof p.role === 'string' ? p.role : null).code;
    const ev = quoteOf(p);
    const confidence = ev.evidence ? confidenceOf(p.confidence) : 'low';
    const rep = split.representative ?? (role !== 'representative' ? text(p.representative, 50) : null);
    if (rep && !NOT_A_NAME.test(rep)) reps.push({ role: 'representative', name: rep, confidence, ...ev });
    if (role === 'representative') {
      reps.push({ role, name, confidence, ...ev });
      continue;
    }
    if (out.some((x) => x.role === role && samePartyName(x.name, name))) continue;
    out.push({ role, name, confidence, ...ev });
  }
  // 대표자를 같은 역할의 당사자로 따로 넣은 경우 → 대표자로만 (법인과 대표자를 같은 당사자로 보지 않음)
  const parties = out.filter((p) => !reps.some((r) => samePartyName(r.name, p.name)));
  for (const r of reps) if (!parties.some((p) => p.role === 'representative' && samePartyName(p.name, r.name))) parties.push(r);
  partiesFromDetails(parties, details, profile);
  const n = normalizePartyRoles(kind, parties.slice(0, MAX_PARTIES));
  return { parties: n.parties, roleMap: n.roleMap, conflicts: n.conflicts };
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
