/**
 * 현금흐름 공통 규칙 — 홈·캘린더·계약 상세·등록 확인이 모두 이 규칙 하나를 쓴다 (모든 계약 종류 공통, 임대차 전용 예외 없음).
 *
 * 1) 돈의 방향(direction)과 돈의 성격(moneyNature)을 따로 본다
 *    - direction: expense 출금 · income 입금 · neutral 방향 확인 필요 (예전 데이터의 "중립"도 여기 — 합계에 넣지 않음)
 *    - 성격: 일반(ordinary) / 보증금·예치금(deposit) — 예전 데이터는 저장된 값을 바꾸지 않고 읽을 때만 해석 (natureOf)
 * 2) 방향은 "누가 내고 누가 받는가"(레지스트리 KIND_MONEY_FLOWS, 계약서가 밝힌 payer/payee 우선) + 사용자가 확정한 역할로 계산
 *    - 계약 종류·이름만으로 정하지 않는다. 이름 일치는 추천일 뿐 (partyMatch.ts)
 *    - 사용자가 직접 고른 방향(directionBasis = user)은 역할을 바꿔도 건드리지 않는다
 *    - 예전 데이터(directionBasis 없음)의 출금·입금도 그대로 둔다. neutral인 보증금 몫만 역할을 확정할 때 함께 제안
 *    - 구독·통신·렌탈·할부·교육·보험처럼 계약 구조상 사용자가 언제나 한쪽인 종류는 역할을 고르지 않아도 방향이 명확 (basis = contract)
 * 3) 돌려받을 돈(보증금·예치금)은 묶음(fund)으로 — 지급은 묶음에 속한 결제(계약금·잔금), 반환은 별도 기록(refunds)
 *    - 반환 확인 기준일: 계약서에 적힌 반환 예정일이 있으면 그날(확정 반환 예정 → 입금/출금 예정에 포함),
 *      없으면 계약 종료일(갱신 반영)에 "반환 확인" 일정만 (합계에 넣지 않음, 확정 반환일로 보지 않음)
 *    - 상태: 반환 예정 · 일부 반환 · 반환 완료 · 반환 지연(계약서의 반환일이 지났는데 남은 금액) — 종료일 기준은 "반환 확인 필요"
 */
import { kindMoneyFlows, mapRole, normalizePartyRoles, ROLE_EQUIVALENTS, type MoneyFlowDef } from '../../supabase/functions/_shared/contractRegistry';

import { partyKindOf, type ContractParty } from './parties';
import { matchUserParty } from './partyMatch';
import { currentTerm } from './status';
import type { Contract, ContractFund, ContractPayment, ContractRecord, Direction, DirectionBasis, FundKind, ISODate } from './types';

export type FlowNature = 'ordinary' | 'deposit';

/** 예전 데이터에서 neutral로 저장된 보증금의 몫 (보증금 계약금·중도금·잔금 — 마이그레이션 20261023000002가 근거 있을 때만 neutral로 둠) */
const LEGACY_DEPOSIT_KINDS = new Set(['deposit', 'down_payment', 'interim_payment', 'balance_payment']);

/** 결제의 돈 성격 — null = 알 수 없음 (예전 데이터의 그 밖의 neutral) */
export function natureOf(p: Pick<ContractPayment, 'moneyNature' | 'kind' | 'direction'>): FlowNature | null {
  if (p.moneyNature === 'refundable_deposit' || p.moneyNature === 'deposit_refund') return 'deposit';
  if (p.moneyNature === 'ordinary') return 'ordinary';
  if (p.kind === 'deposit') return 'deposit';
  if (p.direction === 'neutral') return LEGACY_DEPOSIT_KINDS.has(p.kind) ? 'deposit' : null;
  return 'ordinary';
}

/** 받는 돈을 뜻하는 결제 종류 (급여·상여·용역 대금) — 방향을 아직 모를 때 "지급일/결제일" 같은 말을 고르는 데만 쓴다 (합계에는 쓰지 않음) */
const PAYOUT_KINDS = new Set(['salary', 'bonus', 'service_fee']);
export const isPayoutLike = (p: Pick<ContractPayment, 'direction' | 'kind'>): boolean => p.direction === 'income' || (p.direction === 'neutral' && PAYOUT_KINDS.has(p.kind));

type KindInput = Pick<Contract, 'contractKind' | 'contractType'>;
type SideInput = KindInput & Pick<Contract, 'userPartyRole'> & { userPartyRelation?: Contract['userPartyRelation']; parties?: readonly ContractParty[] };

/**
 * 계약서 용어 → 계약 종류의 자리 (렌탈 계약서의 임차인 → 고객). 당사자 목록이 있으면 그 목록으로 (같은 자리에 다른 이름이면 바꾸지 않음),
 * 없으면 레지스트리 표 그대로. 결제의 지급자·수령자와 사용자 역할에 같은 변환을 쓴다 — 표기가 달라 방향을 못 정하는 일이 없게
 */
function roleMapOf(c: SideInput): Readonly<Record<string, string>> {
  const kind = partyKindOf(c);
  return c.parties ? normalizePartyRoles(kind, c.parties).roleMap : (ROLE_EQUIVALENTS[kind] ?? {});
}

export interface UserSide {
  role: string;
  /** role: 사용자가 확정한 역할 · contract: 계약 구조상 사용자가 언제나 이쪽 */
  basis: Extract<DirectionBasis, 'role' | 'contract'>;
}

/** 사용자(또는 대신 관리하는 사람)가 이 계약에서 어느 쪽인지 — 확정 역할 → 계약 구조. 모르면 null */
export function userSideOf(c: SideInput): UserSide | null {
  if (c.userPartyRole) return { role: mapRole(roleMapOf(c), c.userPartyRole) ?? c.userPartyRole, basis: 'role' };
  const consumer = kindMoneyFlows(partyKindOf(c)).consumerRole;
  return consumer ? { role: consumer, basis: 'contract' } : null;
}

/** 이 결제를 누가 내고 누가 받는가 — 계약서가 밝힌 지급자·수령자 → 계약 종류의 기본 흐름 (반환은 반대 방향) */
export function flowOf(kind: string, p: Pick<ContractPayment, 'moneyNature' | 'kind' | 'direction' | 'payerRole' | 'payeeRole'>): Partial<MoneyFlowDef> | null {
  const nature = natureOf(p);
  const defs = kindMoneyFlows(kind);
  let base: MoneyFlowDef | null = nature === 'deposit' ? defs.deposit : nature === 'ordinary' ? defs.ordinary : null;
  if (base && p.moneyNature === 'deposit_refund') base = { payer: base.payee, payee: base.payer };
  const payer = p.payerRole ?? base?.payer;
  const payee = p.payeeRole ?? base?.payee;
  return payer || payee ? { payer, payee } : null;
}

/** 역할 기준 방향 — 내는 쪽이면 출금, 받는 쪽이면 입금, 아니면(보증인·대리인 등) null */
export function directionForRole(kind: string, p: Parameters<typeof flowOf>[1], role: string): Exclude<Direction, 'neutral'> | null {
  const f = flowOf(kind, p);
  if (!f) return null;
  if (f.payer === role) return 'expense';
  if (f.payee === role) return 'income';
  return null;
}

/** 역할(또는 계약 구조)이 바뀌면 다시 계산하는 결제인지 — 사용자가 고른 방향·예전 출금/입금은 건드리지 않는다 */
function followsRole(p: Pick<ContractPayment, 'direction' | 'directionBasis' | 'moneyNature' | 'kind'>): boolean {
  if (p.directionBasis === 'user') return false;
  if (p.directionBasis === 'role' || p.directionBasis === 'contract') return true;
  // 예전 데이터·basis 없는 새 값: 방향을 아직 정하지 못한 행만
  return p.direction === 'neutral' && natureOf(p) !== null;
}

export interface DirectionChange {
  index: number;
  label: string;
  amount: number;
  nature: FlowNature | null;
  from: Direction;
  to: Direction;
  basis: DirectionBasis | null;
}

/**
 * 역할 확정·변경 미리보기 — 실제로 바뀌는 결제만. 사용자가 확인한 뒤 applyDirectionChanges로 적용한다
 * (역할을 모르게 되면 역할로 계산했던 결제는 다시 "확인 필요"로)
 */
export function roleDirectionChanges(
  c: SideInput,
  payments: readonly Pick<ContractPayment, 'label' | 'amount' | 'direction' | 'directionBasis' | 'moneyNature' | 'kind' | 'payerRole' | 'payeeRole'>[],
): DirectionChange[] {
  const kind = partyKindOf(c);
  const side = userSideOf(c);
  const map = roleMapOf(c);
  const out: DirectionChange[] = [];
  payments.forEach((p, index) => {
    if (!followsRole(p)) return;
    const computed = side ? directionForRole(kind, { ...p, payerRole: mapRole(map, p.payerRole), payeeRole: mapRole(map, p.payeeRole) }, side.role) : null;
    const to: Direction = computed ?? 'neutral';
    const basis: DirectionBasis | null = computed ? side!.basis : null;
    if (to === p.direction && basis === (p.directionBasis ?? null)) return;
    out.push({ index, label: p.label, amount: p.amount, nature: natureOf(p), from: p.direction, to, basis });
  });
  return out;
}

export function applyDirectionChanges<P extends { direction: Direction; directionBasis?: DirectionBasis | null }>(payments: readonly P[], changes: readonly DirectionChange[]): P[] {
  const byIndex = new Map(changes.map((c) => [c.index, c]));
  return payments.map((p, i) => {
    const c = byIndex.get(i);
    return c ? { ...p, direction: c.to, directionBasis: c.basis } : p;
  });
}

/**
 * 역할 확정·변경을 적용한 초안 (등록 확인·수정 화면이 사용자가 "적용"을 누른 뒤에 쓴다)
 * relation: self(내 계약) · on_behalf(다른 사람 계약 관리 — role은 그 사람의 역할) · unknown(잘 모르겠어요 — role 없음)
 */
export function withConfirmedRole<
  D extends SideInput & { payments: P[] },
  P extends Parameters<typeof roleDirectionChanges>[1][number] & { direction: Direction; directionBasis?: DirectionBasis | null },
>(draft: D, role: string | null, relation: NonNullable<Contract['userPartyRelation']> | null = role ? 'self' : 'unknown'): D {
  const next = { ...draft, userPartyRole: role, userPartyRelation: relation };
  return { ...next, payments: applyDirectionChanges(next.payments, roleDirectionChanges(next, next.payments)) };
}

// ===== 돌려받을 돈 묶음 =====

export type FundStatus = 'scheduled' | 'partial' | 'returned' | 'delayed';
export const FUND_STATUS_LABEL: Record<FundStatus, string> = {
  scheduled: '반환 예정',
  partial: '일부 반환',
  returned: '반환 완료',
  delayed: '반환 지연',
};

export interface FundView {
  /** 화면 키 — 저장된 묶음은 id, 예전 계약(묶음 없음)은 'summary' */
  key: string;
  fund: ContractFund | null;
  kind: FundKind;
  label: string;
  total: number;
  /** 이 묶음으로 내는(받는) 결제 — 계약금·잔금 (합계는 total과 같아야 하며 중복으로 세지 않는다) */
  members: ContractPayment[];
  refunded: number;
  remaining: number;
  /** 반환 확인 기준일 */
  checkDate: ISODate | null;
  /** explicit: 계약서에 적힌 반환 예정일 · contract_end: 계약 종료일(확정 반환일 아님) */
  checkBasis: 'explicit' | 'contract_end' | null;
  status: FundStatus;
  /** 종료일 기준 확인 시점이 지났는데 반환 기록이 없음 → "반환 확인 필요" (지연으로 단정하지 않음) */
  needsCheck: boolean;
  /** 사용자가 맡긴 쪽(depositor — 반환은 입금)인지 맡아 둔 쪽(holder — 반환은 출금)인지. 모르면 null */
  userSide: 'depositor' | 'holder' | null;
  /** 반환될 때 사용자 기준 방향 (모르면 neutral) */
  refundDirection: Direction;
}

const fundOf = (fundId: string | null | undefined, funds: readonly ContractFund[]) => funds.find((f) => f.id === fundId) ?? null;

/** 묶음별 결제 — 묶음에 연결된 결제, 예전 계약은 보증금 성격의 결제 전체 */
function membersOf(record: ContractRecord, fund: ContractFund | null): ContractPayment[] {
  const funds = record.funds ?? [];
  if (fund) return record.payments.filter((p) => p.fundId === fund.id);
  return record.payments.filter((p) => natureOf(p) === 'deposit' && !fundOf(p.fundId, funds) && p.moneyNature !== 'deposit_refund');
}

function checkDateOf(contract: Contract, fund: ContractFund | null, today: ISODate): { date: ISODate | null; basis: FundView['checkBasis'] } {
  if (fund?.returnDueOn) return { date: fund.returnDueOn, basis: 'explicit' };
  if (contract.lifecycle !== 'active') return { date: contract.lifecycleChangedOn ?? contract.endDate, basis: contract.lifecycleChangedOn ?? contract.endDate ? 'contract_end' : null };
  const term = currentTerm(contract, today);
  return term ? { date: term.termEnd, basis: 'contract_end' } : { date: null, basis: null };
}

function fundUserSide(record: ContractRecord, fund: ContractFund | null, members: readonly ContractPayment[]): FundView['userSide'] {
  const kind = partyKindOf(record.contract);
  const defs = kindMoneyFlows(kind).deposit;
  const depositor = fund?.depositorRole ?? defs?.payer ?? null;
  const holder = fund?.holderRole ?? defs?.payee ?? null;
  const side = userSideOf(record.contract);
  if (side && side.role === depositor) return 'depositor';
  if (side && side.role === holder) return 'holder';
  if (side) return null;
  // 역할을 모를 때: 사용자가 직접 정한 지급 방향이 있으면 그것으로 (출금 → 맡긴 쪽, 입금 → 맡아 둔 쪽)
  const own = members.filter((p) => p.directionBasis === 'user' && p.direction !== 'neutral' && p.moneyNature !== 'deposit_refund');
  if (own.length > 0 && own.every((p) => p.direction === own[0].direction)) return own[0].direction === 'expense' ? 'depositor' : 'holder';
  return null;
}

/** 계약의 돌려받을 돈 묶음 — 저장된 묶음 + 예전 계약의 보증금(묶음 없이 계약 요약·보증금 결제만 있는 경우) */
export function fundViews(record: ContractRecord, today: ISODate): FundView[] {
  const { contract } = record;
  const funds = record.funds ?? [];
  const list: (ContractFund | null)[] = [...funds];
  const summaryUsed = funds.some((f) => f.totalAmount == null);
  const legacyMembers = membersOf(record, null);
  const summaryDeposit = (contract.depositAmount ?? 0) > 0 && !!kindMoneyFlows(partyKindOf(contract)).deposit;
  if (!summaryUsed && (summaryDeposit || legacyMembers.length > 0)) list.unshift(null);
  return list.map((fund) => {
    const members = membersOf(record, fund);
    const memberSum = members.reduce((s, p) => s + p.amount, 0);
    // 총액: 묶음 총액 → 계약 요약 보증금 → 몫의 합 (몫과 총액을 더하지 않는다)
    const total = fund?.totalAmount ?? contract.depositAmount ?? memberSum;
    const refunded = (fund?.refunds ?? []).reduce((s, r) => s + r.amount, 0);
    const remaining = Math.max(0, total - refunded);
    const { date: checkDate, basis: checkBasis } = checkDateOf(contract, fund, today);
    const userSide = fundUserSide(record, fund, members);
    let status: FundStatus;
    if (total > 0 && refunded >= total) status = 'returned';
    else if (checkBasis === 'explicit' && checkDate && checkDate < today && remaining > 0) status = 'delayed';
    else if (refunded > 0) status = 'partial';
    else status = 'scheduled';
    return {
      key: fund?.id ?? 'summary',
      fund,
      kind: fund?.kind ?? 'deposit',
      label: fund?.label ?? '보증금',
      total,
      members,
      refunded,
      remaining,
      checkDate,
      checkBasis,
      status,
      needsCheck: status !== 'returned' && checkBasis === 'contract_end' && !!checkDate && checkDate < today && remaining > 0,
      userSide,
      refundDirection: userSide === 'depositor' ? 'income' : userSide === 'holder' ? 'expense' : 'neutral',
    };
  });
}

export interface FundCashEntry {
  key: string;
  fundKey: string;
  date: ISODate;
  /** null = 금액이 오가지 않는 확인 일정 (합계에 넣지 않음) */
  amount: number | null;
  direction: Direction;
  /** refund: 실제 반환 기록 · due: 계약서에 적힌 반환 예정 · check: 종료일 기준 반환 확인 */
  type: 'refund' | 'due' | 'check';
  title: string;
}

/** 기간 안의 반환 관련 일정·금액 — 캘린더·홈·상세가 같은 목록을 쓴다 */
export function fundCashEntries(record: ContractRecord, range: { start: ISODate; end: ISODate }, today: ISODate): FundCashEntry[] {
  const inRange = (d: ISODate | null): d is ISODate => !!d && d >= range.start && d <= range.end;
  const out: FundCashEntry[] = [];
  for (const v of fundViews(record, today)) {
    for (const r of v.fund?.refunds ?? []) {
      if (!inRange(r.refundedOn)) continue;
      const partial = r.amount < v.total;
      out.push({ key: `refund:${r.id}`, fundKey: v.key, date: r.refundedOn, amount: r.amount, direction: v.refundDirection, type: 'refund', title: `${v.label} 반환${partial ? ' (일부)' : ''}` });
    }
    if (v.status === 'returned' || v.remaining <= 0 || !inRange(v.checkDate)) continue;
    if (v.checkBasis === 'explicit') {
      out.push({ key: `fund-due:${v.key}`, fundKey: v.key, date: v.checkDate, amount: v.remaining, direction: v.refundDirection, type: 'due', title: `${v.label} 반환 예정` });
    } else if (v.checkBasis === 'contract_end') {
      out.push({ key: `fund-check:${v.key}:${v.checkDate}`, fundKey: v.key, date: v.checkDate, amount: null, direction: v.refundDirection, type: 'check', title: `${v.label} 반환 확인` });
    }
  }
  return out;
}

/**
 * "이 계약에서 누구세요?"를 물을지 — 역할이 금액 방향·반환 의무에 실제로 영향을 줄 때만.
 * 이미 역할을 확정했거나 "잘 모르겠어요"를 골랐으면 다시 묻지 않는다 (상세에서 언제든 바꿀 수 있음)
 */
export function needsRoleQuestion(
  c: SideInput,
  payments: readonly Pick<ContractPayment, 'direction' | 'directionBasis' | 'moneyNature' | 'kind' | 'payerRole' | 'payeeRole'>[],
  hasFund = false,
  /** 내 계약자 정보(등록한 이름) — 기기에서만 대조 */
  contractNames: readonly string[] = [],
): boolean {
  if (c.userPartyRole || c.userPartyRelation === 'unknown') return false;
  const kind = partyKindOf(c);
  const side = userSideOf(c);
  if (side?.basis === 'contract') {
    // 계약 구조로 정한 쪽(예: 렌탈 고객)과 등록한 이름이 다른 쪽(렌탈회사·대표자)에서 나오면 한 번 확인
    if (contractNames.length === 0 || !c.parties?.length) return false;
    const m = matchUserParty(kind, c.parties, contractNames);
    return m.status === 'ambiguous' || (m.status === 'match' && m.role !== side.role);
  }
  const roleMatters = payments.some((p) => followsRole(p) && !!flowOf(kind, p));
  return roleMatters || (hasFund && !!kindMoneyFlows(kind).deposit);
}

/**
 * 저장된 계약을 읽을 때 같은 규칙으로 정리 (앱·서버 알림이 같은 함수 — 저장된 값은 사용자가 다시 저장할 때 바뀜)
 * - 당사자 역할: 계약서 용어 → 계약 종류의 자리 (렌탈의 임대인 → 렌탈회사). 충돌하면 그대로
 * - 결제의 지급자·수령자·사용자 역할·보증금 묶음 역할: 같은 변환
 * - 방향 확인 필요(neutral)로 남은 결제 중 역할(또는 계약 구조)로 정할 수 있는 것만 채운다
 *   (결제 id·근거·묶음·변경 이력 그대로, 사용자가 고른 방향·다른 사람이 내는 예외는 건드리지 않음)
 */
export function normalizeRecord(record: ContractRecord): ContractRecord {
  const c = record.contract;
  const kind = partyKindOf(c);
  const n = normalizePartyRoles(kind, c.parties);
  const m = (r: string | null | undefined) => (r ? mapRole(n.roleMap, r) : r);
  const contract: Contract = { ...c, parties: n.parties, userPartyRole: m(c.userPartyRole) ?? null };
  const mapped = record.payments.map((p) => ({ ...p, payerRole: m(p.payerRole), payeeRole: m(p.payeeRole) }));
  const fill = roleDirectionChanges(contract, mapped).filter((ch) => ch.from === 'neutral' && ch.to !== 'neutral');
  const funds = record.funds?.map((f) => ({ ...f, depositorRole: m(f.depositorRole) ?? null, holderRole: m(f.holderRole) ?? null }));
  // 예전 데이터는 "neutral인 계약금·잔금 = 보증금의 몫"으로 읽었다 (natureOf) — 방향을 채우면 그 해석을 성격으로 고정한다
  const filled = new Set(fill.map((ch) => ch.index));
  const payments = applyDirectionChanges(mapped, fill).map((p, i) =>
    filled.has(i) && !p.moneyNature ? { ...p, moneyNature: natureOf(mapped[i]) === 'deposit' ? ('refundable_deposit' as const) : ('ordinary' as const) } : p,
  );
  return { ...record, contract, payments, ...(funds ? { funds } : {}) };
}
