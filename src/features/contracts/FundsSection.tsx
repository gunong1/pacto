/**
 * 계약 상세 — 보증금·예치금 (돌려받을/돌려줄 돈) · 반환 관리. 규칙은 src/domain/cashflow.ts (fundViews)
 * - 총액(몫을 더하지 않음) · 맡긴 결제(계약금·잔금) · 반환 확인 기준일(계약서의 반환일 / 계약 종료일 — 확정 반환일 아님)
 * - 반환 상태: 반환 예정 · 일부 반환 · 반환 완료 · 반환 지연 (종료일 기준이 지나면 "반환 확인 필요")
 * - 반환 기록: 실제로 돌려받은(돌려준) 금액과 날짜 — 원래 지급 결제는 바꾸지 않는다. 일부 반환은 여러 번
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { AmountField } from '@/components/ui/AmountField';
import { Badge } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Divider, KeyValueRow, Section, SectionGap } from '@/components/ui/layout';
import { FUND_STATUS_LABEL, fundViews, type FundView } from '@/domain/cashflow';
import { formatDateKo, isValidISODate, normalizeDateInput } from '@/domain/dates';
import { formatAmountInput, formatWon, parseAmount } from '@/domain/money';
import type { ContractRecord, ISODate } from '@/domain/types';
import { spacing } from '@/theme';

import { useContractActions } from './queries';

const sideText = (v: FundView) =>
  v.userSide === 'depositor' ? '돌려받을 돈' : v.userSide === 'holder' ? '돌려줄 돈' : '누가 돌려받는지 확인 필요 — 내 역할을 확정하면 정해져요';

export function FundsSection({ record, today, confirm }: { record: ContractRecord; today: ISODate; confirm: (title: string, body: string, ok: string) => Promise<boolean> }) {
  const views = fundViews(record, today);
  const actions = useContractActions(record.contract.id);
  if (views.length === 0) return null;
  return (
    <>
      <SectionGap />
      <Section title="보증금 · 예치금" caption="계약금·잔금으로 나눠 낸 돈도 하나로 관리해요. 반환은 실제로 돌려받은(돌려준) 날 기록해요." testID="detail-funds">
        {views.map((v, i) => (
          <View key={v.key} testID={`fund-${v.kind}-${i}`}>
            {i > 0 ? <Divider /> : null}
            <FundBlock view={v} today={today} onAdd={(amount, date) => actions.addRefund.mutate([v.key, { amount, refundedOn: date }])} onRemove={async (id, label) => {
              if (await confirm('반환 기록 삭제', `${label} 기록을 지울까요?`, '삭제')) actions.removeRefund.mutate([id]);
            }} busy={actions.addRefund.isPending} />
          </View>
        ))}
      </Section>
    </>
  );
}

function FundBlock({ view: v, today, onAdd, onRemove, busy }: { view: FundView; today: ISODate; onAdd: (amount: number, date: ISODate) => void; onRemove: (id: string, label: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const parsedDate = normalizeDateInput(date) ?? date;
  const parsedAmount = parseAmount(amount);
  const valid = parsedAmount != null && parsedAmount > 0 && isValidISODate(parsedDate);
  // 날짜를 다 입력했는데(6자리 이상) 없는 날짜면 알려 준다 — 기록 버튼은 막혀 있음
  const dateError = date.replace(/\D/g, '').length >= 6 && !isValidISODate(parsedDate) ? '올바른 날짜가 아니에요 (예: 261130 → 2026-11-30)' : undefined;
  const tone = v.status === 'returned' ? 'primary' : v.status === 'delayed' ? 'caution' : v.needsCheck ? 'check' : 'neutral';
  return (
    <View style={{ paddingVertical: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <AppText variant="body2Strong">{v.label}</AppText>
        <Badge label={v.needsCheck && v.status === 'scheduled' ? '반환 확인 필요' : FUND_STATUS_LABEL[v.status]} tone={tone} />
      </View>
      <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.xs }} testID="fund-side">
        {sideText(v)}
      </AppText>
      <KeyValueRow label="총액" value={formatWon(v.total)} testID="fund-total" />
      {v.members.length > 0 ? <KeyValueRow label="나눠 낸 금액" value={v.members.map((p) => `${p.label} ${formatWon(p.amount)}`).join(' + ')} /> : null}
      {v.checkDate ? (
        <KeyValueRow label={v.checkBasis === 'explicit' ? '반환 예정일 (계약서)' : '반환 확인 기준일 (계약 종료일)'} value={formatDateKo(v.checkDate)} testID="fund-check-date" />
      ) : (
        <KeyValueRow label="반환 확인 기준일" value="종료일을 입력하면 정해져요" />
      )}
      {v.refunded > 0 ? <KeyValueRow label="반환된 금액" value={formatWon(v.refunded)} testID="fund-refunded" /> : null}
      {v.status !== 'returned' ? <KeyValueRow label="남은 금액" value={formatWon(v.remaining)} emphasis testID="fund-remaining" /> : null}
      {(v.fund?.refunds ?? []).map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xxs }} testID={`refund-${r.id}`}>
          <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
            {formatDateKo(r.refundedOn)} 반환 {formatWon(r.amount)}
          </AppText>
          <Pressable onPress={() => onRemove(r.id, `${formatDateKo(r.refundedOn)} ${formatWon(r.amount)}`)} accessibilityRole="button" testID={`refund-remove-${r.id}`}>
            <AppText variant="captionStrong" color="textTertiary">
              삭제
            </AppText>
          </Pressable>
        </View>
      ))}
      {v.status !== 'returned' ? (
        open ? (
          <View style={{ marginTop: spacing.sm }} testID="refund-form">
            <AmountField label="반환 금액" value={amount} onChangeText={setAmount} suffix="원" placeholder={formatAmountInput(v.remaining)} testID="refund-amount" />
            {/* 반환일은 실제로 돌려받은(돌려준) 날 — 계약서 반환 예정일·계약 종료일은 참고일일 뿐 자동으로 넣지 않는다 */}
            <DateField
              label="반환일 (실제로 돌려받은·돌려준 날)"
              value={date}
              onChangeText={setDate}
              error={dateError}
              hint={`숫자만 입력해도 돼요 (261130 → 2026-11-30)${v.checkDate ? ` · 참고: ${v.checkBasis === 'explicit' ? '계약서 반환 예정일' : '계약 종료일'} ${formatDateKo(v.checkDate)}` : ''}`}
              testID="refund-date"
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="기록" size="sm" disabled={!valid} loading={busy} onPress={() => {
                  if (!valid) return;
                  onAdd(parsedAmount!, parsedDate);
                  setOpen(false);
                  setAmount('');
                }} testID="refund-save" />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="취소" size="sm" variant="secondary" onPress={() => setOpen(false)} testID="refund-cancel" />
              </View>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" testID="refund-add" style={{ marginTop: spacing.sm }}>
            <AppText variant="captionStrong" color="primary">
              + 반환 기록하기 (일부 반환도 가능)
            </AppText>
          </Pressable>
        )
      ) : null}
    </View>
  );
}
