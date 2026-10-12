/**
 * 계약 당사자 표시 규칙 — 등록 확인 · 계약 수정 · 계약 상세 · 목록이 함께 쓴다 (화면마다 규칙을 따로 두지 않음).
 *
 * 1) 역할 이름은 레지스트리(PARTY_ROLE_DEFS) 한 곳에서: 임대차 = 임대인/임차인, 근로 = 사용자(고용주)/근로자 …
 * 2) 당사자 목록(parties)이 있으면 그것이 기준 — 원래 있어야 하는 역할(main)을 찾지 못했으면 비워 두고 "확인 필요"
 *    (다른 쪽 이름으로 채우지 않음). 공동 임차인처럼 같은 역할이 여럿이면 한 행에 모두
 * 3) 당사자 목록이 없는 예전 계약: 역할이 이름에 붙은 예전 칸(임대인·임차인·근로자)은 그 역할로, 그 밖의 상대방 이름(counterparty)은
 *    역할을 추측하지 않고 "계약 상대방"으로 보여준다. 예전 계약에는 "확인 필요" 행을 만들지 않는다 (데이터를 바꾸지 않음)
 * 4) 사용자가 어느 쪽인지(userPartyRole)는 사용자가 고른 경우에만 — 기본은 모름
 * 이름은 공통 민감정보 가림 정책을 따른다 (서버가 저장 전에 가리고, 화면은 maskSensitiveDeep를 거친 값을 쓴다).
 */
import { CONTRACT_KIND_CODES, partyRoleDef, partyRolesOf } from '../../supabase/functions/_shared/contractRegistry';

import { detailFields, type ContractDetails, type ContractType } from './contractTypes';

export interface ContractParty {
  role: string;
  name: string;
  /** 계약서가 쓴 역할 이름이 계약 종류의 역할 이름과 다를 때 (렌탈회사 ← 계약서 "임대인") — 표시용, 저장된 역할은 role 하나 */
  term?: string | null;
  /** 사용자가 "같은 자리의 다른 당사자"라고 정함 (예: 렌탈회사와 별개의 임대인) — 자동 연결·합치기 안 함 */
  distinct?: boolean;
}

/** 역할 표시: "렌탈회사(임대인)" — 계약서 용어가 다를 때만 괄호로 */
export function partyRoleLabel(kind: string, role: string, term?: string | null): string {
  const label = partyRoleDef(kind, role).label;
  return term && term !== label ? `${label}(${term})` : label;
}
const termOf = (parties: readonly ContractParty[], role: string) => parties.find((p) => p.role === role && p.term)?.term ?? null;

export interface PartyRow {
  /** 화면 키 (party:<역할> · counterparty) */
  key: string;
  /** 역할 코드 (계약 상대방 행은 null) */
  role: string | null;
  label: string;
  names: string[];
  /** 원래 있어야 하는 역할인데 계약서에서 찾지 못함 → "확인 필요" */
  missing: boolean;
  /** 사용자가 고른 내 역할 */
  isUser: boolean;
}

export const COUNTERPARTY_LABEL = '계약 상대방';
export const MISSING_PARTY = '확인 필요';

interface PartyInput {
  contractKind: string | null;
  contractType: ContractType;
  parties: readonly ContractParty[];
  details: ContractDetails;
  counterparty: string | null;
  userPartyRole: string | null;
}

/** 당사자 역할을 고를 계약 종류 — 분류 개편 전 계약은 저장된 유형이 같은 이름의 종류면 그것으로 */
export const partyKindOf = (c: Pick<PartyInput, 'contractKind' | 'contractType'>): string =>
  c.contractKind ?? ((CONTRACT_KIND_CODES as readonly string[]).includes(c.contractType) ? c.contractType : 'other');

const clean = (s: string | null | undefined) => (s ?? '').trim();
const sameName = (a: string, b: string) => a.replace(/\s/g, '') === b.replace(/\s/g, '');

/** 예전 버전의 역할 칸(임대인·임차인·근로자) → 당사자 (읽기 호환 — 저장된 값은 그대로) */
export function legacyDetailParties(contractType: ContractType, details: ContractDetails): ContractParty[] {
  return detailFields(contractType)
    .filter((f) => f.party && typeof details[f.key] === 'string' && clean(details[f.key] as string))
    .map((f) => ({ role: f.party!, name: clean(details[f.key] as string) }));
}

/** 역할 순서: 그 종류의 역할(레지스트리 순서) → 그 밖의 역할(계약서가 밝힌 순서) */
function grouped(kind: string, parties: readonly ContractParty[]): { role: string; names: string[] }[] {
  const order = [...partyRolesOf(kind).map((r) => r.code), ...parties.map((p) => p.role)];
  const roles = order.filter((r, i) => order.indexOf(r) === i);
  return roles.map((role) => ({ role, names: parties.filter((p) => p.role === role && clean(p.name)).map((p) => clean(p.name)) }));
}

export function partyRows(c: PartyInput): PartyRow[] {
  const kind = partyKindOf(c);
  const row = (role: string, names: string[], missing: boolean): PartyRow => ({
    key: `party:${role}`,
    role,
    label: partyRoleLabel(kind, role, termOf(c.parties, role)),
    names,
    missing,
    isUser: c.userPartyRole === role,
  });
  if (c.parties.length > 0) {
    return grouped(kind, c.parties)
      .filter((g) => g.names.length > 0 || partyRoleDef(kind, g.role).main)
      .map((g) => row(g.role, g.names, g.names.length === 0));
  }
  // 예전 계약 — 있는 값만 (확인 필요 행 없음, 역할 추측 없음)
  const legacy = legacyDetailParties(c.contractType, c.details);
  const rows = grouped(kind, legacy).filter((g) => g.names.length > 0).map((g) => row(g.role, g.names, false));
  const other = clean(c.counterparty);
  if (other && !legacy.some((p) => sameName(p.name, other))) rows.push({ key: 'counterparty', role: null, label: COUNTERPARTY_LABEL, names: [other], missing: false, isUser: false });
  return rows;
}

/** 행 표시값 — "김민수, 이수진" 또는 "확인 필요" */
export const partyRowText = (r: PartyRow): string => (r.missing ? MISSING_PARTY : r.names.join(', '));

/**
 * 목록·상세 머리의 짧은 상대방 표시:
 *   내 역할을 골랐으면 상대 쪽 이름 / 예전 상대방 이름(counterparty) / 아니면 찾은 당사자 "임대인 김민수 · 임차인 박지훈"
 */
export function partySummary(c: PartyInput): string | null {
  const rows = partyRows(c).filter((r) => !r.missing);
  if (c.userPartyRole && c.parties.length > 0) {
    const others = rows.filter((r) => r.role !== c.userPartyRole && r.role !== null).flatMap((r) => r.names);
    if (others.length > 0) return others.join(', ');
  }
  if (clean(c.counterparty)) return clean(c.counterparty);
  return rows.length > 0 ? rows.map((r) => `${r.label} ${r.names.join(', ')}`).join(' · ') : null;
}

/** 검색에 쓰는 이름 (모든 당사자 + 예전 상대방) */
export const partySearchText = (c: PartyInput): string => [clean(c.counterparty), ...c.parties.map((p) => clean(p.name)), ...legacyDetailParties(c.contractType, c.details).map((p) => p.name)].join(' ');

/** 폼의 역할별 입력값 "김민수, 이수진" → 당사자 목록 (쉼표로 나눈 이름 각각). terms: 역할별 계약서 용어 (그대로 유지) */
export function partiesFromInputs(inputs: Record<string, string | undefined>, terms: Record<string, string | undefined> = {}, distinct: readonly string[] = []): ContractParty[] {
  return Object.entries(inputs).flatMap(([role, text]) =>
    (text ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ role, name: name.slice(0, 100), ...(terms[role] ? { term: terms[role] } : {}), ...(distinct.includes(role) ? { distinct: true } : {}) })),
  );
}

/** "서로 다른 당사자"로 정한 역할 목록 (폼에 숨겨 두었다가 저장할 때 다시 붙인다) */
export const partyDistinctOf = (parties: readonly ContractParty[]): string[] => [...new Set(parties.filter((p) => p.distinct).map((p) => p.role))];

/** 당사자 목록 → 역할별 계약서 용어 (폼에 숨겨 두었다가 저장할 때 다시 붙인다) */
export function partyTermsOf(parties: readonly ContractParty[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parties) if (p.term && !out[p.role]) out[p.role] = p.term;
  return out;
}

/** 당사자 목록 → 역할별 입력값 (같은 역할은 쉼표로) */
export function partiesToInputs(parties: readonly ContractParty[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parties) out[p.role] = out[p.role] ? `${out[p.role]}, ${p.name}` : p.name;
  return out;
}
