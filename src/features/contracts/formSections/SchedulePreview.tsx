/**
 * 저장하면 관리될 결제·일정 미리보기 — 계약 조건이 실제 일정·지출 관리로 이어지는 것을 보여준다.
 * 계산은 도메인 함수(paymentPlan·contractSchedule)만 쓴다 — 폼에서 따로 판단하지 않는다.
 */
import { useMemo } from 'react';
import { View } from 'react-native';

import { EVENT_COLOR } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Section } from '@/components/ui/layout';
import { draftToRecord } from '@/data/draft';
import { addMonths, formatDateKo } from '@/domain/dates';
import { FREQUENCY_LABEL } from '@/domain/labels';
import { formatWon } from '@/domain/money';
import { paymentPlan } from '@/domain/paymentPlan';
import { contractSchedule, expandPayment } from '@/domain/schedule';

import { contractFormSchema, formToDraft, type ContractFormValues } from '../form';
import { styles } from './styles';

/** 입력값으로 결제별 일정 요약(첫 결제·총 회차·마지막 결제) 계산 — 폼 미리보기·결제 카드 공통 */
export function usePaymentPlans(values: ContractFormValues, today: string) {
  return useMemo(() => {
    const parsed = contractFormSchema.safeParse(values);
    if (!parsed.success) return null;
    const record = draftToRecord(formToDraft(parsed.data, today), 'preview', today);
    return { record, plans: record.payments.map((p) => ({ p, plan: paymentPlan(p, record, today) })) };
  }, [values, today]);
}

export function SchedulePreview({ values, today }: { values: ContractFormValues; today: string }) {
  const computed = usePaymentPlans(values, today);
  const preview = useMemo(() => {
    if (!computed) return null;
    const { record } = computed;
    const pays = computed.plans.map(({ p, plan }) => ({ p, plan, first: expandPayment(p, record.contract, { start: '1900-01-01', end: '2999-12-31' }, record.dates)[0] ?? null }));
    const items = contractSchedule(record, { start: today, end: addMonths(today, 36) }, today).filter((i) => i.type !== 'payment');
    return { items: items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6), pays };
  }, [computed, today]);

  return (
    <Section title="저장하면 관리되는 결제·일정" testID="schedule-preview">
      {!preview ? (
        <AppText variant="body2" color="textTertiary">
          필수 정보를 확인하면 일정이 표시돼요.
        </AppText>
      ) : preview.items.length === 0 && preview.pays.length === 0 ? (
        <AppText variant="body2" color="textTertiary">
          날짜·결제 정보를 입력하면 일정이 만들어져요.
        </AppText>
      ) : (
        <View style={styles.preview}>
          {preview.pays.map(({ p, plan, first }) => (
            <PreviewRow
              key={p.id}
              color={EVENT_COLOR.payment}
              title={`${p.label} ${formatWon(p.amount)}`}
              sub={[
                p.frequency === 'one_time' ? '일시불' : `${FREQUENCY_LABEL[p.frequency]}${p.dayOfMonth ? ` ${p.dayOfMonth}일` : ''}`,
                first ? `${p.frequency === 'one_time' ? '' : '첫 결제 '}${formatDateKo(first.date)}` : null,
                plan ? (plan.total != null ? `총 ${plan.total}회 · 마지막 ${formatDateKo(plan.last!)}` : '종료일 없이 반복') : null,
                p.direction === 'neutral' ? '지출 합계 제외' : p.direction === 'income' ? '수입' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
          {preview.items.map((i) => (
            <PreviewRow key={i.key} color={EVENT_COLOR[i.type]} title={i.title} sub={formatDateKo(i.date, true)} />
          ))}
        </View>
      )}
    </Section>
  );
}

function PreviewRow({ color, title, sub }: { color: string; title: string; sub: string }) {
  return (
    <View style={styles.previewRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <AppText variant="body2Strong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {sub}
        </AppText>
      </View>
    </View>
  );
}
