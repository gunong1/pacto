/**
 * 급여 상세 (근로계약 등 급여 결제) — 규칙: src/domain/payroll.ts. 금액은 엔진이 계산한 값을 그대로 보여 준다 (화면에서 계산하지 않음).
 * - 세전 고정 월 급여 + 구성 (확정 항목) — 확정 수입
 * - 추가 지급 가능 (조건부·변동·일회성·최대 금액) — 확정 전에는 수입 합계에 넣지 않음 · 지급 확정(실제 날짜·금액) / 지급 제외
 * - 조건부 항목을 모두 받으면 얼마인지는 "예시"로만 (확정 월급 아님)
 * - 첫·마지막 급여 일할 계산 내역 (규정이 확인된 경우) / 확인할 규정 안내
 * - 세전 금액 — 공제액을 몰라 실수령액은 계산하지 않음
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AmountField } from '@/components/ui/AmountField';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Section } from '@/components/ui/layout';
import { formatDateKo, normalizeDateInput } from '@/domain/dates';
import { formatWon, parseAmount } from '@/domain/money';
import { COMPONENT_STATUS_LABEL, PAY_TYPE_LABEL, PAYROLL_RULE_LABEL, prorationPlan, proratedText, salaryBreakdown, variableAmount, type ProratedPay } from '@/domain/payroll';
import type { ContractPayment, ContractRecord, PaymentComponent } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

type Actions = {
  confirm: (index: number, input: { date: string; amount: number }) => void;
  setStatus: (index: number, status: 'pending' | 'needs_check' | 'excluded') => void;
};

const CHECK_COPY: Record<string, string> = {
  mismatch: '확정 항목 합계가 월 급여와 달라요. 계약서를 확인해주세요.',
  includes_conditional: '월 급여가 조건부 항목을 포함한 금액인지 확실하지 않아요. 계약서를 확인해주세요.',
  needs_classification: '지급 조건을 알 수 없는 항목이 있어요. 정보 수정에서 매월 확정인지 조건부인지 골라주세요.',
};

export function SalaryCard({ record, payment, actions }: { record: ContractRecord; payment: ContractPayment; actions: Actions }) {
  const b = salaryBreakdown(payment);
  const plan = prorationPlan(record, payment);
  const tid = `salary-${payment.id}`;
  const all = payment.components ?? [];
  return (
    <Section title="급여" caption="세전 금액이에요. 공제액을 알 수 없어 실수령액은 계산하지 않아요." testID={tid}>
      <AppText variant="caption" color="textTertiary">
        세전 고정 월 급여
      </AppText>
      <AppText variant="title2" tabular testID={`${tid}-fixed`}>
        {formatWon(payment.amount)}
      </AppText>
      {b.fixed.length > 0 ? (
        <View style={{ marginTop: spacing.xs, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 2 }} testID={`${tid}-parts`}>
          {b.fixed.map((c) => (
            <Row key={c.label} label={c.label} value={formatWon(c.amount)} />
          ))}
        </View>
      ) : null}
      {CHECK_COPY[b.check] ? (
        <View style={{ marginTop: spacing.sm, flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }} testID={`${tid}-check`}>
          <Badge label="확인 필요" tone="check" />
          <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
            {CHECK_COPY[b.check]}
          </AppText>
        </View>
      ) : null}

      {[...b.extra, ...b.unknown].length > 0 ? (
        <View style={{ marginTop: spacing.lg }} testID={`${tid}-extra`}>
          <AppText variant="body2Strong">추가 지급 가능 수당</AppText>
          <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.xs }}>
            지급이 확정되기 전에는 수입 합계·캘린더에 넣지 않아요.
          </AppText>
          {[...b.extra, ...b.unknown].map((c) => (
            <ExtraRow key={c.label} c={c} index={all.indexOf(c)} tid={tid} actions={actions} />
          ))}
          {b.maxWithConditional != null ? (
            <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.bgSubtle }} testID={`${tid}-max`}>
              <Row label="조건부 수당을 모두 받으면 (예시)" value={formatWon(b.maxWithConditional)} />
              <AppText variant="small" color="textTertiary">
                확정 월급이 아니라 조건을 모두 채웠을 때의 예시 금액이에요.
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg }} testID={`${tid}-proration`}>
        {plan.status === 'ready' ? (
          <>
            {plan.first ? <Prorated p={plan.first} tid={`${tid}-first`} /> : null}
            {plan.last ? <Prorated p={plan.last} tid={`${tid}-last`} /> : null}
            {!plan.first && !plan.last ? (
              <AppText variant="caption" color="textSecondary">
                첫 급여 {formatDateKo(plan.firstPayDate)} 지급 예정 (일할 계산 없음)
              </AppText>
            ) : null}
            {plan.notes.map((n) => (
              <AppText key={n} variant="small" color="textTertiary">
                · {n}
              </AppText>
            ))}
          </>
        ) : plan.status === 'needs_rules' ? (
          <AppText variant="caption" color="textSecondary" testID={`${tid}-needs-rules`}>
            첫 급여 자동 계산 전 확인 필요
            {plan.reason ? ` — ${plan.reason}` : ''}
            {plan.missing.length > 0 ? ` — ${plan.missing.map((k) => PAYROLL_RULE_LABEL[k]).join(' · ')}` : ''}. 계약서에 있으면 정보 수정에서 입력해주세요. 그전에는 월 급여 전액으로 표시해요.
          </AppText>
        ) : null}
      </View>
    </Section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
      <AppText variant={strong ? 'body2Strong' : 'caption'} color={strong ? 'text' : 'textSecondary'} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? 'body2Strong' : 'caption'} color={strong ? 'text' : 'textSecondary'} tabular>
        {value}
      </AppText>
    </View>
  );
}

function ExtraRow({ c, index, tid, actions }: { c: PaymentComponent; index: number; tid: string; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const [dateText, setDateText] = useState('');
  const [amountText, setAmountText] = useState('');
  const date = normalizeDateInput(dateText);
  const amount = parseAmount(amountText);
  const status = c.status ?? (c.pay === 'unknown' || c.pay == null ? 'needs_check' : 'pending');
  const calc = c.pay === 'variable' ? variableAmount(c) : null;
  const amountLabel = c.pay === 'variable' ? (calc != null ? `${formatWon(calc)} (산식 계산)` : '금액 미정 (근무시간 필요)') : `${c.amountKind === 'max' ? '최대 ' : c.amountKind === 'range' ? '범위 ' : ''}${formatWon(c.amount)}`;
  const t = `${tid}-extra-${index}`;
  return (
    <View style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }} testID={t}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
        <AppText variant="body2Strong" style={{ flex: 1 }}>
          {c.label}
        </AppText>
        <AppText variant="body2" tabular>
          {amountLabel}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
        <Badge label={PAY_TYPE_LABEL[c.pay ?? 'unknown']} tone="neutral" />
        <Badge label={COMPONENT_STATUS_LABEL[status]} tone={status === 'confirmed' ? 'primary' : status === 'excluded' ? 'neutral' : 'check'} />
      </View>
      {c.condition ? (
        <AppText variant="caption" color="textSecondary" style={{ marginTop: 4 }}>
          지급 조건: {c.condition}
        </AppText>
      ) : null}
      {status === 'confirmed' ? null : open ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <DateField label="실제 지급일" value={dateText} onChangeText={setDateText} testID={`${t}-date`} />
          <AmountField label="실제 지급 금액 (세전)" value={amountText} onChangeText={setAmountText} suffix="원" testID={`${t}-amount`} />
          <Button label="지급 확정 (수입에 반영)" size="sm" disabled={!date || !amount} onPress={() => date && amount && actions.confirm(index, { date, amount })} testID={`${t}-save`} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="지급 확정" size="sm" variant="secondary" onPress={() => setOpen(true)} testID={`${t}-open`} />
          {status === 'excluded' ? (
            <Button label="다시 미확정으로" size="sm" variant="secondary" onPress={() => actions.setStatus(index, 'pending')} testID={`${t}-reset`} />
          ) : (
            <Button label="지급 제외" size="sm" variant="secondary" onPress={() => actions.setStatus(index, 'excluded')} testID={`${t}-exclude`} />
          )}
        </View>
      )}
    </View>
  );
}

function Prorated({ p, tid }: { p: ProratedPay; tid: string }) {
  const [open, setOpen] = useState(true);
  const text = proratedText(p);
  return (
    <View style={{ marginBottom: spacing.sm }} testID={tid}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="body2Strong">{p.kind === 'first' ? '첫 급여 (일할 계산)' : '마지막 급여 (일할 계산)'}</AppText>
        <AppText variant="body2Strong" tabular>
          {formatWon(p.total)}
        </AppText>
      </Pressable>
      <AppText variant="caption" color="textTertiary">
        예상 세전 지급액 · {formatDateKo(p.payDate)} 지급 예정
      </AppText>
      {open ? (
        <View style={{ marginTop: 4, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 2 }}>
          <Row label="급여 산정기간" value={`${formatDateKo(p.period.from)} ~ ${formatDateKo(p.period.to)}`} />
          <Row label="근무 기간" value={text.title.split(' · ')[1]} />
          <AppText variant="caption" color="textSecondary">
            {text.detail}
          </AppText>
          {p.lines.map((l) => (
            <Row key={l.label} label={`${l.label} ${formatWon(l.monthly)} ${l.method === 'full' ? '전액' : `중 ${p.days}일분`}`} value={formatWon(l.amount)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
