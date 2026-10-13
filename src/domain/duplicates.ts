/**
 * 중복 등록으로 보이는 계약 — 같은 계약서를 두 번 등록한 경우를 사용자에게 알리기만 한다.
 * - 합계에서 빼거나 삭제하지 않는다 (같은 조건의 계약이 실제로 둘일 수도 있음 — 판단은 사용자)
 * - 모든 계약 종류 공통. 근거가 충분할 때만 묶는다: 계약 종류 · 시작일 · 종료일 · 보증금 · 결제(주기·금액 목록) · 당사자 이름이 모두 같음
 *   (제목·메모·돈의 성격·방향은 비교하지 않음 — 한쪽만 고친 경우에도 찾도록)
 * - 시작일도 결제도 없는 계약은 비교하지 않는다 (빈 계약끼리 묶이지 않게)
 */
import { partyKindOf } from './parties';
import type { ContractRecord } from './types';

const signature = (r: ContractRecord): string | null => {
  const c = r.contract;
  if (c.lifecycle !== 'active') return null;
  const pays = r.payments.map((p) => `${p.frequency}:${p.amount}`).sort();
  if (!c.startDate && pays.length === 0) return null;
  const names = c.parties.map((p) => p.name.replace(/\s+/g, '')).filter(Boolean).sort();
  return JSON.stringify([partyKindOf(c), c.startDate, c.endDate, c.depositAmount ?? 0, pays, names]);
};

/** 중복으로 보이는 계약 묶음 (각 묶음은 계약 id 2개 이상, 등록 순서) — 같은 묶음 키는 id를 정렬해 만든다 */
export function likelyDuplicateGroups(records: readonly ContractRecord[]): { key: string; contractIds: string[] }[] {
  const bySig = new Map<string, string[]>();
  for (const r of records) {
    const sig = signature(r);
    if (!sig) continue;
    bySig.set(sig, [...(bySig.get(sig) ?? []), r.contract.id]);
  }
  return [...bySig.values()].filter((ids) => ids.length > 1).map((ids) => ({ key: [...ids].sort().join('+'), contractIds: ids }));
}
