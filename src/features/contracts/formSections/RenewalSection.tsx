/**
 * 갱신 · 통보 기한 섹션 — 자동갱신 · 갱신 주기 · 해지·갱신 통보기한(종료 며칠 전) · 기한의 의미
 * 날짜를 계산해 캘린더·알림에 넣는 값 중심. 조항 내용은 계약 체크에서 보여준다.
 * 중도해지·위약금 메모는 직접 입력에만 — 계약서 등록은 계약 체크에서 조항을 보여주므로 입력칸을 두지 않는다 (저장된 글은 상세 기록에 유지).
 */
import { Controller } from 'react-hook-form';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { RadioGroup, SwitchRow } from '@/components/ui/controls';
import { Section } from '@/components/ui/layout';
import type { ContractType } from '@/domain/contractTypes';
import { NOTICE_KIND_OPTIONS } from '@/domain/noticeKind';
import { spacing } from '@/theme';

import type { PaymentFormValues } from '../form';
import type { FormKit } from './kit';

/** 빠른 입력에서 자동갱신을 켤 때 미리 채우는 갱신 주기 (결제 주기와 같게) */
const RENEWAL_MONTHS: Record<PaymentFormValues['frequency'], number> = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, yearly: 12, one_time: 12 };

export function AutoRenewalFields({ kit, quick }: { kit: FormKit; quick: boolean }) {
  const { control, getValues, setValue, values, flagged, evidence, field } = kit;
  return (
    <>
      <Controller
        control={control}
        name="autoRenewal"
        render={({ field: f }) => (
          <SwitchRow
            label="자동갱신"
            description="만료 시 자동으로 연장되는 계약 (묵시적 갱신 포함)"
            value={f.value}
            onValueChange={(on) => {
              // 빠른 입력: 갱신 주기를 결제 주기로 미리 채운다 (바꿀 수 있음)
              if (quick && on && !getValues('renewalPeriodMonths').trim()) setValue('renewalPeriodMonths', String(RENEWAL_MONTHS[getValues('quick.frequency') ?? 'monthly'] ?? 12));
              f.onChange(on);
            }}
            testID="field-autoRenewal"
          />
        )}
      />
      {flagged?.has('autoRenewal') ? (
        <AppText variant="caption" color="check" style={{ marginBottom: spacing.sm }}>
          자동갱신 여부를 확인해주세요{evidence?.autoRenewal ? ` — 원문: “${evidence.autoRenewal}”` : ''}
        </AppText>
      ) : null}
      {values.autoRenewal ? field('renewalPeriodMonths', '갱신 주기', { keyboardType: 'number-pad', suffix: '개월', maxLength: 3 }) : null}
    </>
  );
}

function TermsFields({ kit, type }: { kit: FormKit; type: ContractType }) {
  return (
    <>
      {kit.field('earlyTerminationTerms', type === 'loan' ? '중도상환 관련 내용' : '종료·중도해지 관련 메모', { multiline: true })}
      {kit.field('penaltyTerms', '위약금 관련 내용', { multiline: true })}
    </>
  );
}

/** 자동갱신 스위치는 withSwitch일 때만 (빠른 입력은 위쪽 "선택" 섹션에 있다) */
export function RenewalSection({ kit, type, hasRenewal, quick, withSwitch }: { kit: FormKit; type: ContractType; hasRenewal: boolean; quick: boolean; withSwitch: boolean }) {
  const { control, values, flagged, hint, field } = kit;
  if (!hasRenewal) return quick ? <Section title="중도해지 · 위약금"><TermsFields kit={kit} type={type} /></Section> : null;
  return (
    <Section title="갱신 · 통보 기한" caption="종료일 기준 기한을 계산해 캘린더·알림에 넣어요. 조항 내용은 계약 체크에서 확인하세요." testID="section-renewal">
      {withSwitch ? <AutoRenewalFields kit={kit} quick={quick} /> : null}
      {field('terminationNoticeDays', '해지·갱신 통보기한 (종료 며칠 전까지)', { keyboardType: 'number-pad', suffix: '일 전', maxLength: 3 })}
      {values.terminationNoticeDays?.trim() ? (
        <View style={{ marginBottom: spacing.lg }} testID="notice-kind">
          <AppText variant="captionStrong" color="textSecondary">
            이 기한은 어떤 의미인가요?
          </AppText>
          {flagged?.has('noticeKind') ? (
            <AppText variant="caption" color="check" style={{ marginTop: 2 }}>
              {hint('noticeKind') ?? '계약서에서 이 기한의 의미를 확인해주세요'}
            </AppText>
          ) : null}
          <Controller control={control} name="noticeKind" render={({ field: f }) => <RadioGroup options={NOTICE_KIND_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix="notice-kind" />} />
        </View>
      ) : null}
      {quick ? <TermsFields kit={kit} type={type} /> : null}
    </Section>
  );
}
