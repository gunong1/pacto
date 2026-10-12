/**
 * 내 계약자 정보(등록한 이름)와 계약서 당사자 대조 — 추천만 한다 (확정은 사용자가).
 *
 * - 대조는 기기 안에서만 한다: 등록한 이름을 서버·AI에 보내지 않고, 로그에 남기지 않는다
 * - 같은 사람인지 판단: 띄어쓰기·대소문자·"(인)"·마침표 같은 표기만 맞춘 뒤 "완전히 같을 때"만 (비슷한 이름은 다른 사람)
 *   영문·다른 표기는 사용자가 등록한 표기만 인정한다
 * - 일치하는 당사자가 정확히 한 명일 때만 그 역할을 추천. 같은 이름이 여러 당사자에 나오면(동명이인·중복) 추천하지 않음
 * - 이름이 일치하지 않으면 역할을 고르지 않는다
 * - 보증인·대리인으로만 일치하면 그 역할을 추천하되, 돈을 내거나 받는 쪽이 아니라는 사실을 함께 알린다
 * - 추천은 저장하지 않는다. 이미 확정한 역할은 이름을 바꿔도 그대로 (이 함수는 확정 역할을 바꾸지 않음)
 */
import { kindMoneyFlows, partyRoleDef } from '../../supabase/functions/_shared/contractRegistry';

import type { ContractParty } from './parties';

/** 등록할 수 있는 이름 수 (DB valid_contract_names와 같음) */
export const MAX_CONTRACT_NAMES = 5;
export const MAX_CONTRACT_NAME_LENGTH = 50;

/** 표기만 맞춘다: 공백·"(인)"·"(서명)"·마침표·가운뎃점 제거, 영문 소문자 — 글자를 바꾸거나 비슷한 글자로 보지 않는다 */
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/\(\s*(?:인|서명|날인|印)\s*\)/g, '')
    .replace(/[\s.,·ㆍ・\-_'"]/g, '')
    .toLowerCase();
}

/** 입력한 이름 목록 정리: 앞뒤 공백 제거 · 빈 값·같은 표기 중복 제거 · 최대 5개 · 50자 */
export function cleanContractNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim().slice(0, MAX_CONTRACT_NAME_LENGTH).trim();
    if (!n || out.some((x) => normalizePersonName(x) === normalizePersonName(n))) continue;
    out.push(n);
    if (out.length >= MAX_CONTRACT_NAMES) break;
  }
  return out;
}

export type PartyMatch =
  /** 등록한 이름이 없음 */
  | { status: 'no_names' }
  /** 일치하는 당사자 없음 → 역할을 고르지 않는다 */
  | { status: 'none' }
  /** 같은 이름이 여러 당사자에 나옴 → 자동으로 고르지 않는다 */
  | { status: 'ambiguous'; roles: string[] }
  /** 정확히 한 당사자와 일치 → 추천 (확정 아님). moneySide = 이 역할이 돈을 내거나 받는 쪽인지 */
  | { status: 'match'; role: string; roleLabel: string; partyIndex: number; moneySide: boolean };

/** 이 역할이 계약 종류의 돈 흐름(일반·보증금)에서 내거나 받는 쪽인지 — 보증인·대리인·중개업자는 아니다 */
export function isMoneySideRole(kind: string, role: string): boolean {
  const f = kindMoneyFlows(kind);
  return [f.ordinary, f.deposit].some((x) => !!x && (x.payer === role || x.payee === role));
}

export function matchUserParty(kind: string, parties: readonly ContractParty[], contractNames: readonly string[]): PartyMatch {
  const mine = new Set(contractNames.map(normalizePersonName).filter(Boolean));
  if (mine.size === 0) return { status: 'no_names' };
  const hits = parties.map((p, i) => ({ p, i })).filter(({ p }) => mine.has(normalizePersonName(p.name)));
  if (hits.length === 0) return { status: 'none' };
  if (hits.length > 1) return { status: 'ambiguous', roles: hits.map((h) => h.p.role) };
  const { p, i } = hits[0];
  return { status: 'match', role: p.role, roleLabel: partyRoleDef(kind, p.role).label, partyIndex: i, moneySide: isMoneySideRole(kind, p.role) };
}
