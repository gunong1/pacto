/**
 * 대출 상환 계획 (규칙: src/domain/loanPlan.ts) — 금액 카드를 회차마다 나열하지 않고 한 장으로.
 * [대출 정보] 원금 · 실행일~만기일 · 금리(고정/변동) · 상환 방식
 * [이자 납부] 매월 N일 · 첫 납부일 · 계산 기준 · 첫 이자 예상액 → "예상 이자 일정 펼치기"
 * [원금 상환] 만기일 · 상환 원금 (실행일의 원금은 입출금으로 보지 않음)
 * 계산 조건이 부족하면 금액을 확정하지 않고 무엇이 필요한지 알려준다. 계약서 예시 금액은 계산과 대조만 한다.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { Section } from '@/components/ui/layout';
import { detailFields } from '@/domain/contractTypes';
import { formatDateKo } from '@/domain/dates';
import { installmentText, interestExamples, interestPayment, LOAN_TERM_LABEL, loanPlan, principalRepayment } from '@/domain/loanPlan';
import { formatWon, formatWonShort } from '@/domain/money';
import type { ContractRecord } from '@/domain/types';
import { colors, hitSlop, spacing } from '@/theme';

import type { ContractFormValues } from './form';
import { usePaymentPlans } from './formSections/SchedulePreview';

const optionLabel = (key: string, value: unknown) => detailFields('loan').find((f) => f.key === key)?.options?.find((o) => o.value === value)?.label ?? null;

export function LoanPlanCard({ record, testID = 'loan-plan', compact }: { record: ContractRecord; testID?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const plan = loanPlan(record);
  if (plan.status === 'not_loan') return null;
  const d = record.contract.details as Record<string, unknown>;
  const interest = interestPayment(record);
  const repay = principalRepayment(record);
  const examples = interestExamples(record, plan);
  const principal = typeof d.principal === 'number' ? d.principal : null;
  return (
    <Section title="대출 상환 계획" caption={compact ? undefined : '이자는 규칙 하나로 매월 계산해요. 대출 실행 때 받은 원금은 입출금으로 넣지 않아요.'} testID={testID}>
      <Group title="대출 정보">
        <Row label="대출 원금" value={principal != null ? formatWon(principal) : '입력 필요'} />
        <Row label="기간" value={record.contract.startDate && record.contract.endDate ? `${formatDateKo(record.contract.startDate)} 실행 ~ ${formatDateKo(record.contract.endDate)} 만기` : '실행일·만기일 입력 필요'} />
        <Row label="금리" value={typeof d.interestRate === 'number' ? `연 ${d.interestRate}%${d.rateType ? ` · ${optionLabel('rateType', d.rateType)}` : ''}` : '입력 필요'} />
        <Row label="상환 방식" value={optionLabel('repaymentMethod', d.repaymentMethod) ?? '입력 필요'} />
      </Group>

      <Group title="이자 납부">
        <Row label="납부일" value={interest?.dayOfMonth ? `매월 ${interest.dayOfMonth}일` : '이자 납부 항목 없음'} />
        <Row label="계산 기준" value={[optionLabel('interestDayCount', d.interestDayCount), optionLabel('interestPeriod', d.interestPeriod)].filter(Boolean).join(' · ') || '입력 필요'} />
        {plan.status === 'ready' ? (
          <>
            <Row label="첫 납부" value={`${formatDateKo(plan.interest[0].payDate)} · ${formatWon(plan.interest[0].amount)}`} testID={`${testID}-first`} />
            <Row label="이자 합계 (예상)" value={`${formatWon(plan.totalInterest)} · ${plan.interest.length}회`} />
            {plan.estimated ? <Badge label="예상 금액" tone="check" /> : null}
            {plan.notes.map((n) => (
              <AppText key={n} variant="small" color="textTertiary">
                · {n}
              </AppText>
            ))}
            <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={hitSlop} testID={`${testID}-toggle`}>
              <AppText variant="captionStrong" color="primary">
                예상 이자 일정 {plan.interest.length}회 {open ? '접기 ▴' : '펼쳐보기 ▾'}
              </AppText>
            </Pressable>
            {open ? (
              <View style={{ gap: 4, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }} testID={`${testID}-schedule`}>
                {plan.interest.map((x) => {
                  const t = installmentText(x, plan.terms);
                  return (
                    <View key={x.no} style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                        {formatDateKo(x.payDate)} · {t.title}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" tabular>
                        {formatWon(x.amount)}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <AppText variant="caption" color="textSecondary" testID={`${testID}-needs`}>
            {plan.reason ?? `이자를 계산하려면 ${plan.missing.map((k) => LOAN_TERM_LABEL[k]).join(' · ')}이(가) 필요해요.`} 그전에는 저장된 금액을 예상으로만 보여 드려요.
          </AppText>
        )}
      </Group>

      <Group title="원금 상환">
        {repay ? (
          <Row label="만기 원금 상환" value={`${formatDateKo(repay.startsOn)} · ${formatWon(repay.amount)}`} testID={`${testID}-principal`} />
        ) : plan.status === 'ready' ? (
          <AppText variant="caption" color="check">
            만기({formatDateKo(plan.principal!.date)}) 원금 {formatWonShort(plan.principal!.amount)} 상환 항목이 없어요. 정보 수정에서 ‘원리금 상환’ 1회로 추가해주세요.
          </AppText>
        ) : (
          <AppText variant="caption" color="textTertiary">
            나눠 갚는 대출은 계약서의 상환 일정대로 상환 항목을 입력해주세요.
          </AppText>
        )}
      </Group>

      {examples.length > 0 ? (
        <Group title="계약서 예시 금액 대조">
          {examples.map((e) => (
            <Row key={`${e.label}-${e.amount}`} label={e.label} value={`${formatWon(e.amount)} ${e.matched ? '✓ 계산과 같음' : '· 계산과 다름 (확인 필요)'}`} />
          ))}
        </Group>
      ) : null}
    </Section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.sm, gap: 4 }}>
      <AppText variant="body2Strong">{title}</AppText>
      {children}
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }} testID={testID}>
      <AppText variant="caption" color="textSecondary" style={{ flexShrink: 0 }}>
        {label}
      </AppText>
      <AppText variant="caption" color="text" tabular style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}

/** 수정 화면: 입력 중인 값으로 상환 계획 미리보기 (저장 전 — 계산은 같은 도메인 함수) */
export function LoanFormPlan({ values, today }: { values: ContractFormValues; today: string }) {
  const computed = usePaymentPlans(values, today);
  if (!computed) return null;
  return <LoanPlanCard record={computed.record} testID="form-loan-plan" compact />;
}
