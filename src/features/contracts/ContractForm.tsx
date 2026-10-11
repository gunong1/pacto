import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge, ChipGroup } from '@/components/ui/controls';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import type { ContractDraft } from '@/data/repository';
import { profileOf, detailFields, cleanDetails, type ContractType, type DetailValue, type Direction } from '@/domain/contractTypes';
import { suggestKind } from '@/domain/categorySuggestion';
import { canRegisterKind, contractKindDef, isSubtypeOf, kindDisplay, legacyOf, type KindClassification } from '@/domain/contractKinds';
import { FREQUENCY_LABEL } from '@/domain/labels';
import { parseAmount } from '@/domain/money';
import { colors, hitSlop, spacing } from '@/theme';

import {
  contractFormSchema,
  detailFromInput,
  detailsToForm,
  formProfile,
  formToDraft,
  quickDefaultFrequency,
  quickDirectionAdvice,
  quickHasDetails,
  type ContractFormValues,
  type ParsedContractForm,
} from './form';
import { DatesList } from './formSections/DatesSection';
import { DetailsSection } from './formSections/DetailsSection';
import { formKit, FormLabel } from './formSections/kit';
import { AiKindJudgment, KindChooser } from './formSections/KindSection';
import { ComponentsEditor, CustomFirstDate, FREQUENCY_OPTIONS, PaymentsList, PlanLine } from './formSections/PaymentsSection';
import { AutoRenewalFields, RenewalSection } from './formSections/RenewalSection';
import { SchedulePreview, usePaymentPlans } from './formSections/SchedulePreview';
import { styles } from './formSections/styles';


export interface ContractFormProps {
  defaultValues: ContractFormValues;
  /** "확인 필요" 표시 경로 ('startDate', 'payments.1.startsOn', 'contractType' …) */
  flagged?: ReadonlySet<string>;
  /** 경로별 원문 근거 */
  evidence?: Partial<Record<string, string>>;
  /** 경로별 안내 (왜 확인이 필요한지) */
  notes?: Partial<Record<string, string>>;
  /** AI의 계약 종류 판단 (확인 화면) — 한 줄로 보여주고 사용자가 바꿀 수 있다. 신뢰도 낮음이면 골라야 최종 등록 */
  classification?: KindClassification;
  /** 모든 유형의 상세 속성 추출값 — 유형을 바꾸면 새 유형에 맞는 값만 다시 고른다 */
  allDetails?: Record<string, DetailValue>;
  header?: React.ReactNode;
  /** 폼과 일정 미리보기 아래에 붙는 보조 영역 (예: AI 체크 요약) */
  trailing?: React.ReactNode;
  footerNote?: string;
  /** 저장 요청이 실패했을 때 보여줄 안내 (서버 오류 등) */
  submitError?: string | null;
  submitLabel: string;
  submitting?: boolean;
  today: string;
  onSubmit: (draft: ContractDraft) => void;
  /**
   * quick: 직접 입력 — 계약명·유형·금액·주기·다음 결제일 + 선택(기간·자동갱신·메모)만 보이고,
   * 나머지는 "상세 정보 추가"를 눌렀을 때 펼친다. defaultValues.quick이 있어야 한다.
   */
  variant?: 'full' | 'quick';
  /** create: 새로 등록 / edit: 저장된 계약 수정 (같은 화면·같은 입력, 상세 정보가 있으면 처음부터 펼침) */
  mode?: 'create' | 'edit';
}

/** 빠른 입력의 돈 방향 (중립 = 보증금처럼 돌려받는 돈·해당 없음) */
const QUICK_DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: 'expense', label: '지출' },
  { value: 'income', label: '수입' },
  { value: 'neutral', label: '중립·해당 없음' },
];

/** 빠른 입력의 기본 주기 — 매매·일회성·용역은 일시불, 나머지는 매월 */
export { quickDefaultFrequency } from './form';
/** 빠른 입력 화면에 늘 보이는 값 — 이 밖의 오류는 접힌 상세 정보에 있다 */
/** 갱신·통보 기한 칸 (등록 확인 화면에서는 평소 숨김) */
const RENEWAL_KEYS: ReadonlySet<string> = new Set(['autoRenewal', 'renewalPeriodMonths', 'terminationNoticeDays', 'noticeKind', 'earlyTerminationTerms', 'penaltyTerms']);
const QUICK_VISIBLE: ReadonlySet<string> = new Set(['title', 'contractKind', 'contractType', 'quick', 'startDate', 'endDate', 'autoRenewal', 'renewalPeriodMonths', 'memo']);

/**
 * 계약 확인/수정 폼 — AI 등록 확인, 직접 입력, 수정에서 공용.
 * 공통 틀(유형 → 기본 정보 → 기간 → 유형별 정보 → 결제 목록 → 주요 날짜 → 갱신·해지 → 기타)은 같고,
 * 유형에 따라 날짜 이름·유형별 정보·결제 의미 선택지가 바뀐다. 결제·날짜는 여러 건 추가/수정/삭제할 수 있다.
 * 이 파일은 폼 상태와 섹션 배치만 맡는다. 각 섹션은 formSections/ (계약 종류·유형별 정보·금액·주요 날짜·갱신·미리보기).
 * 폼은 의미를 다시 판단하지 않는다 — 서버 분석 결과(또는 저장된 값)를 보여주고 사용자가 고친 값만 저장한다.
 */
export function ContractForm({ defaultValues: initialValues, flagged, evidence, notes, classification, allDetails, header, trailing, footerNote, submitError, submitLabel, submitting, today, onSubmit, variant = 'full', mode = 'create' }: ContractFormProps) {
  // 신뢰도 낮음: AI가 고른 종류를 미리 선택하지 않는다 (후보 중에서 사용자가 골라야 최종 등록)
  const defaultValues = classification?.confidence === 'low' ? { ...initialValues, contractKind: '', contractSubtype: '' } : initialValues;
  const quick = variant === 'quick' && !!defaultValues.quick;
  // 수정 화면: 저장된 상세 정보가 있으면 처음부터 펼친다 / 이미 정해진 분야·금액 구분은 자동으로 바꾸지 않는다
  const editing = mode === 'edit';
  const [more, setMore] = useState(() => quick && editing && quickHasDetails(defaultValues));
  /** 사용자가 계약 종류를 직접 골랐으면 더 이상 계약명 추천으로 바꾸지 않는다 (수정 화면은 처음부터 고른 상태) */
  const [kindPicked, setKindPicked] = useState(editing);
  /** 빠른 입력: 금액 구분(지출·수입·중립)을 직접 골랐는지 (고른 뒤에는 유형을 바꿔도 유지) */
  const [directionPicked, setDirectionPicked] = useState(editing);
  /** 수정 화면(전체 입력): 갱신·통보 기한 펼침 */
  // 등록 확인 화면: 갱신·통보 기한은 평소 숨긴다 (계약 체크에서 넣기). 단, 자동갱신인데 갱신 주기가 비어 있으면
  // 저장할 수 없으므로 처음부터 펼쳐 보여준다. 저장할 때 이 칸들에 오류가 있어도 펼친다
  const renewalNeedsInput = !quick && !editing && defaultValues.autoRenewal && !defaultValues.renewalPeriodMonths.trim();
  const [renewalOpen, setRenewalOpen] = useState(renewalNeedsInput);
  const [renewalForced, setRenewalForced] = useState(renewalNeedsInput);
  /** 저장 버튼을 눌렀는데 입력 확인이 필요한 경우의 안내 (어느 칸인지 모르면 저장이 안 되는 것처럼 보인다) */
  const [invalidNote, setInvalidNote] = useState<string | null>(null);
  const { control, handleSubmit, setValue, getValues } = useForm<ContractFormValues, unknown, ParsedContractForm>({
    resolver: zodResolver(contractFormSchema),
    defaultValues,
    mode: 'onTouched',
  });
  // 결제 값의 id(저장된 결제 id)와 겹치지 않게 목록 키는 'key'
  const payments = useFieldArray({ control, name: 'payments', keyName: 'key' });
  const dates = useFieldArray({ control, name: 'dates' });

  const values = useWatch({ control }) as ContractFormValues;
  // 결제별 계산 결과 (빠른 입력 결제가 있으면 맨 앞, 그 뒤로 추가 결제)
  const plans = usePaymentPlans(values, today)?.plans;

  // 관리 프로필 (화면 이름·유형별 속성·결제 의미 선택지) — 계약 종류 기준. 결제 일정은 입력한 결제에서 만든다
  const type = formProfile(values);
  const profile = profileOf(type);

  const kit = formKit({ control, setValue, getValues, values, flagged, evidence, notes });
  const { field, amount, date } = kit;

  /**
   * 계약 종류 변경: 결제·날짜는 그대로 두고, 유형별 정보만 새 관리 프로필 기준으로 다시 고른다.
   * source: 사용자가 고름(user) / 계약명 추천 그대로(suggested). 하위 호환값은 저장할 때 레지스트리 값으로
   */
  const changeKind = useCallback(
    (next: string | null, source: 'user' | 'suggested') => {
      const prevKind = getValues('contractKind');
      if ((next ?? '') === prevKind) return;
      const prev = formProfile({ contractKind: prevKind, contractType: getValues('contractType') });
      const nextProfile = next ? (contractKindDef(next)!.profile as ContractType) : prev;
      const current = getValues('details');
      const merged: Record<string, DetailValue> = { ...(allDetails ?? {}) };
      for (const spec of detailFields(prev)) {
        const v = detailFromInput(spec, current[spec.key] ?? '');
        if (v !== undefined && v !== null) merged[spec.key] = v;
      }
      // 빠른 입력: 주기를 직접 바꾸지 않았다면 새 종류의 기본 주기로 (결제 방식은 사용자가 정함 — 처음 값만 제안)
      if (quick && getValues('quick.frequency') === quickDefaultFrequency(prev)) setValue('quick.frequency', quickDefaultFrequency(nextProfile));
      // 빠른 입력: 금액 구분(지출·수입·중립)을 직접 고르지 않았다면 새 종류의 추천으로 (고른 뒤에는 유지)
      if (quick && !directionPicked) setValue('quick.direction', quickDirectionAdvice(nextProfile).direction);
      setValue('contractKind', next ?? '');
      if (next) {
        const legacy = legacyOf(next);
        setValue('contractType', legacy.contractType);
        setValue('category', legacy.category);
      }
      if (!next || !isSubtypeOf(next, getValues('contractSubtype'))) setValue('contractSubtype', '');
      setValue('classification', { ...getValues('classification'), source });
      setValue('details', detailsToForm(nextProfile, cleanDetails(nextProfile, merged)));
    },
    [allDetails, quick, directionPicked, getValues, setValue],
  );
  const pickKind = (code: string) => {
    if (!contractKindDef(code)) return;
    setKindPicked(true);
    changeKind(code, 'user');
  };

  // 빠른 입력: 계약명으로 종류 추천 (AI 분류 아님 · 확정 아님 · 애매하면 추천 없음 · 직접 고르면 그 값 유지)
  const nameSuggestion = quick ? suggestKind(values.title ?? '') : null;
  const suggestedKind = nameSuggestion?.kind ?? null;
  useEffect(() => {
    if (!quick || kindPicked) return;
    changeKind(suggestedKind, 'suggested');
  }, [quick, kindPicked, suggestedKind, changeKind]);

  // 계약 종류 (한 번만 고른다). 분류 개편 전 계약은 예전 표시 이름을 안내만 하고, 고르면 새 분류로
  const selectedKind = values.contractKind || null;
  const legacy = kindDisplay({ contractKind: null, contractSubtype: null, contractType: values.contractType, category: values.category });
  const kindChooser = (
    <KindChooser
      kind={selectedKind}
      subtype={values.contractSubtype || null}
      legacyLabel={!selectedKind && editing && (defaultValues.contractKind ?? '') === '' ? legacy.label : null}
      recommended={quick && !kindPicked && !!selectedKind}
      onPickKind={pickKind}
      onPickSubtype={(sub) => {
        setKindPicked(true);
        setValue('contractSubtype', sub ?? '');
        setValue('classification', { ...getValues('classification'), source: 'user' });
      }}
    />
  );
  const paymentsBlock = <PaymentsList kit={kit} payments={payments} paymentKinds={profile.paymentKinds} plans={plans} notes={notes} />;
  const datesBlock = <DatesList kit={kit} dates={dates} dateKinds={profile.dateKinds} />;
  const renewalBlock = (withSwitch: boolean) => <RenewalSection kit={kit} type={type} hasRenewal={profile.hasRenewal} quick={quick} withSwitch={withSwitch} />;

  const submit = handleSubmit(
    (v) => {
      // 신뢰도 낮음: 사용자가 계약 종류를 골라야 최종 등록 (임의로 확정하지 않음)
      if (classification && !canRegisterKind(classification, v.contractKind || null)) {
        setInvalidNote('계약 종류를 확인해주세요 — AI가 확신하지 못해 후보 중에서 골라야 등록돼요');
        return;
      }
      setInvalidNote(null);
      // 새 계약은 종류를 고르지 않았으면 기타 (분류 개편 전 계약을 수정할 때는 종류 없이 그대로)
      const parsed = !v.contractKind && !editing ? { ...v, contractKind: 'other', ...legacyOf('other') } : v;
      onSubmit(confirmEdited(formToDraft(parsed, today), defaultValues, getValues()));
    },
    (errors) => {
      const keys = Object.keys(errors);
      // 빠른 입력: 접힌 상세 정보에 오류가 있으면 펼쳐서 보여준다
      if (quick && keys.some((k) => !QUICK_VISIBLE.has(k))) setMore(true);
      // 전체 입력: 숨겨 둔 갱신·통보 기한에 오류가 있으면 그 칸을 펼친다
      if (!quick && keys.some((k) => RENEWAL_KEYS.has(k))) {
        setRenewalForced(true);
        setRenewalOpen(true);
      }
      const first = firstErrorMessage(errors);
      setInvalidNote(`저장 전에 확인이 필요해요${first ? `: ${first}` : ''}`);
    },
  );
  const footer = (
    <View>
      {footerNote ? (
        <AppText variant="caption" color="textTertiary" align="center" style={{ marginBottom: spacing.sm }}>
          {footerNote}
        </AppText>
      ) : null}
      {invalidNote || submitError ? (
        <AppText variant="caption" color="caution" align="center" style={{ marginBottom: spacing.sm }} testID="submit-error">
          {invalidNote ?? submitError}
        </AppText>
      ) : null}
      <Button label={submitLabel} loading={submitting} onPress={submit} testID="submit-contract" />
    </View>
  );

  if (quick) {
    const q = values.quick;
    const advice = quickDirectionAdvice(type);
    const income = q?.direction === 'income';
    const oneTime = q?.frequency === 'one_time';
    return (
      <Screen edges={['bottom']} footer={footer}>
        {header}
        <Section testID="quick-basic">
          {field('title', '계약명', { placeholder: '예: 유튜브 프리미엄' })}
          <FormLabel label="계약 종류" flagged={flagged?.has('contractKind')} />
          {kindChooser}
        </Section>

        <SectionGap />
        <Section title="금액" caption="비워두면 결제 없이 저장돼요" testID="quick-payment">
          {field('quick.amount', '금액', { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true, testID: 'quick-amount' })}
          {q?.amount?.trim() ? (
            <ComponentsEditor components={q.components ?? []} total={parseAmount(q.amount)} onChange={(next) => setValue('quick.components', next)} testID="quick-components" />
          ) : null}
          <View style={styles.directionLabel}>
            <FormLabel label="금액 구분" />
            {advice.clear && !directionPicked && q?.direction === advice.direction ? <Badge label="추천" tone="primary" /> : null}
          </View>
          <Controller
            control={control}
            name="quick.direction"
            render={({ field: f }) => (
              <ChipGroup
                options={QUICK_DIRECTION_OPTIONS}
                value={f.value ?? advice.direction}
                onChange={(d) => {
                  setDirectionPicked(true);
                  f.onChange(d);
                }}
                testIDPrefix="quick-direction"
              />
            )}
          />
          <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm, marginBottom: spacing.lg }} testID="quick-direction-hint">
            {q?.direction === 'neutral' ? '보증금처럼 돌려받는 돈 · 해당 없음 — 지출·수입 합계에 넣지 않아요.' : advice.roles}
          </AppText>
          <FormLabel label={income ? '지급 주기' : '결제 주기'} />
          <Controller control={control} name="quick.frequency" render={({ field: f }) => <ChipGroup options={FREQUENCY_OPTIONS} value={f.value ?? 'monthly'} onChange={f.onChange} scroll testIDPrefix="quick-frequency" />} />
          <View style={{ height: spacing.lg }} />
          {oneTime ? (
            date('quick.nextDate', income ? '지급 예정일' : '결제 예정일', { testID: 'quick-nextDate' })
          ) : (
            <>
              <View style={styles.colNarrow}>
                {field('quick.day', income ? '지급일' : '결제일', {
                  keyboardType: 'number-pad',
                  suffix: '일',
                  maxLength: 2,
                  placeholder: '예: 15',
                  testID: 'quick-day',
                  hint: `${q?.frequency === 'monthly' || !q?.frequency ? '매월' : FREQUENCY_LABEL[q.frequency]} 몇 일에 ${income ? '받나요?' : '결제되나요?'}`,
                })}
              </View>
              <AppText variant="caption" color="textTertiary" testID="quick-auto-note">
                첫 {income ? '지급' : '결제'} 시점은 시작일과 {income ? '지급일' : '결제일'}을 기준으로 자동 계산해요.
              </AppText>
            </>
          )}
          {/* 총 회차·마지막 결제일은 종료일(또는 계약서 회차)로 계산 */}
          {!oneTime && values.quick?.amount?.trim() ? <PlanLine plan={plans?.[0]?.plan ?? null} income={income} testID="quick-plan" /> : null}
        </Section>

        <SectionGap />
        <Section title="선택" testID="quick-optional">
          <View style={styles.row2}>
            <View style={styles.col}>{date('startDate', '시작일')}</View>
            <View style={styles.col}>{date('endDate', '종료일')}</View>
          </View>
          {profile.hasRenewal ? <AutoRenewalFields kit={kit} quick={quick} /> : null}
          {field('memo', '메모', { multiline: true, placeholder: '자유롭게 적어두세요' })}
        </Section>

        <View style={styles.moreWrap}>
          <Pressable
            onPress={() => setMore((m) => !m)}
            accessibilityRole="button"
            accessibilityState={{ expanded: more }}
            hitSlop={hitSlop}
            testID="toggle-more"
            style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.bgSubtle }]}>
            <Ionicons name={more ? 'remove' : 'add'} size={18} color={colors.primary} />
            <AppText variant="body2Strong" color="primary">
              {more ? '상세 정보 접기' : '상세 정보 추가'}
            </AppText>
            <AppText variant="caption" color="textTertiary" style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
              {more ? '' : '상대방 · 통보기한 · 주요 날짜 · 위약금 …'}
            </AppText>
          </Pressable>
        </View>

        {more ? (
          <View testID="quick-more">
            <SectionGap />
            <Section title="상세 정보">
              {field('counterparty', '계약 상대방', { placeholder: '예: 구글' })}
              {date('contractDate', '계약 체결일', { hint: '기록용이에요. 캘린더와 알림에는 쓰지 않아요.' })}
              {!oneTime ? (
                <CustomFirstDate income={income} initialOpen={!!values.quick?.nextDate} onClear={() => setValue('quick.nextDate', '')} testID="quick-firstToggle">
                  {date('quick.nextDate', income ? '첫 지급일' : '첫 결제일', { testID: 'quick-firstDate' })}
                </CustomFirstDate>
              ) : null}
            </Section>
            <DetailsSection kit={kit} type={type} />
            <SectionGap />
            <Section title="추가 금액" caption="위 금액 말고 따로 오가는 돈이 있으면 (설치비·보증금 등). 위 금액을 이루는 항목(기본급·수당 등)은 넣지 않아요." testID="section-payments">
              {paymentsBlock}
            </Section>
            <SectionGap />
            <Section title="주요 날짜" caption="설치일·입주일처럼 챙겨야 할 날짜. 캘린더에 표시돼요." testID="section-dates">
              {datesBlock}
            </Section>
            <SectionGap />
            {renewalBlock(false)}
            <SectionGap />
            <Section title="기타 조건">
              {amount('totalAmount', '계약 총액')}
              {type !== 'lease' ? amount('depositAmount', '보증금') : null}
            </Section>
          </View>
        ) : null}

        <SectionGap />
        <SchedulePreview values={values} today={today} />
        {trailing}
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} footer={footer}>
      {header}

      <Section title="계약 종류" caption="이 계약이 무엇인지 한 번만 골라주세요. 종류에 맞게 일정과 지출을 관리해요." testID="section-type">
        {classification ? <AiKindJudgment classification={classification} picked={selectedKind} flagged={flagged?.has('contractKind')} onPick={pickKind} /> : null}
        {kindChooser}
      </Section>

      <SectionGap />
      <Section title="기본 정보">
        {field('title', '계약명', { placeholder: '예: 자동차보험' })}
        {field('counterparty', '계약 상대방', { placeholder: '예: 삼성화재' })}
      </Section>

      <SectionGap />
      <Section title="기간">
        <View style={styles.row2}>
          <View style={styles.col}>{date('startDate', profile.startLabel)}</View>
          <View style={styles.col}>{date('endDate', profile.endLabel)}</View>
        </View>
        {date('contractDate', '계약 체결일 (선택)', { hint: '기록용이에요. 캘린더와 알림에는 쓰지 않아요.' })}
      </Section>

      <DetailsSection kit={kit} type={type} />

      <SectionGap />
      <Section title="금액" caption="계약에서 실제로 나가거나 들어오는 돈을 관리해요. 확정된 금액만 캘린더·지출·수입에 들어가요. 합계 금액을 이루는 항목(기본급·수당 등)은 따로 넣지 않고 그 금액의 구성항목으로 보여줘요." testID="section-payments">
        {paymentsBlock}
      </Section>

      <SectionGap />
      <Section title="주요 날짜" caption="설치일·입주일·잔금일처럼 챙겨야 할 날짜. 캘린더에 표시돼요." testID="section-dates">
        {datesBlock}
      </Section>

      {/* 갱신·통보 기한: 등록 확인 화면에는 두지 않는다 (AI가 찾은 값으로 저장, 확인이 필요하면 계약 체크 카드에서 넣기). 수정 화면은 "+ 상세 정보"에 */}
      {(editing || renewalForced) && profile.hasRenewal ? (
        <>
          <SectionGap />
          <View style={styles.moreWrap}>
            <Pressable onPress={() => setRenewalOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: renewalOpen }} hitSlop={hitSlop} testID="toggle-renewal" style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.bgSubtle }]}>
              <Ionicons name={renewalOpen ? 'remove' : 'add'} size={18} color={colors.primary} />
              <AppText variant="body2Strong" color="primary">
                상세 정보
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {renewalOpen ? '' : '자동갱신 · 통보 기한'}
              </AppText>
            </Pressable>
          </View>
          {renewalOpen ? renewalBlock(true) : null}
        </>
      ) : null}

      <SectionGap />
      <Section title="기타">
        {amount('totalAmount', '계약 총액')}
        {type !== 'lease' ? amount('depositAmount', '보증금') : null}
        {field('memo', '메모', { multiline: true, placeholder: '자유롭게 적어두세요' })}
      </Section>

      <SectionGap />
      <SchedulePreview values={values} today={today} />
      {trailing}
    </Screen>
  );
}

/** AI가 추정한 값을 사용자가 고쳐 저장하면 그 값은 사용자가 확인한 값(user_confirmed) */
function confirmEdited(draft: ContractDraft, before: ContractFormValues, after: ContractFormValues): ContractDraft {
  const at = (o: unknown, path: string) => path.split('.').reduce<unknown>((v, k) => (v != null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
  const sources = { ...draft.valueSources };
  for (const [path, src] of Object.entries(sources)) {
    if (src === 'inferred' && JSON.stringify(at(before, path) ?? '') !== JSON.stringify(at(after, path) ?? '')) sources[path] = 'user_confirmed';
  }
  return { ...draft, valueSources: sources };
}

/** 검증 오류 중 첫 번째 안내 문구 (중첩된 결제·날짜 칸 포함) */
function firstErrorMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null;
  const e = errors as { message?: unknown };
  if (typeof e.message === 'string' && e.message) return e.message;
  for (const [k, v] of Object.entries(errors)) {
    if (k === 'ref') continue;
    const m = firstErrorMessage(v);
    if (m) return m;
  }
  return null;
}
