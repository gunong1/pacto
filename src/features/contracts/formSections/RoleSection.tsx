/**
 * "이 계약에서 누구세요?" — 등록 확인 · 직접 입력 · 계약 수정이 함께 쓴다 (규칙: src/domain/cashflow.ts · partyMatch.ts)
 * - 계약서 당사자(역할 · 이름) 중에서 고른다. 등록한 이름과 정확히 한 명이 일치하면 "추천" 표시 (추천 ≠ 확정 — 사용자가 눌러야 저장)
 * - 선택지는 공통 규칙 roleChoices: 돈을 내거나 받는 주요 당사자가 먼저, 그 밖의 당사자(중개업자·보증인 등)·
 *   "다른 사람의 계약을 관리하고 있어요"·"잘 모르겠어요"는 "다른 경우"를 눌러야 보인다 (이미 고른 역할이 그쪽이면 펼친 채로)
 * - "다른 사람의 계약을 관리하고 있어요" → 관리하는 분이 어느 쪽인지 고른다 (그분 기준으로 출금·입금)
 * - "잘 모르겠어요" → 다시 묻지 않고, 방향을 정할 수 없는 금액은 "확인 필요"로 둔다 (합계에 넣지 않음)
 * - 역할이 금액 방향·반환 의무에 영향을 줄 때만 펼쳐서 묻는다. 접힌 상태에서도 [변경]/[역할 선택]은 항상 보인다
 *   (확정한 역할만 "확정" — 모름·미정은 "미정")
 * - 고르면 바뀌는 금액(변경 예정)을 먼저 보여주고, "적용"을 눌러야 반영 (사용자가 직접 고른 방향은 바뀌지 않음)
 * - 이름이 없으면 한 번 안내 (계약서에 쓰는 이름 · 건너뛰기) — 이름은 기기에서만 대조, 서버·AI로 보내지 않음
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge, TextField } from '@/components/ui/controls';
import { needsRoleQuestion, recommendedSide, roleChoices, roleDirectionChanges, type DirectionChange, type RoleChoice } from '@/domain/cashflow';
import { DIRECTION_LABEL } from '@/domain/contractTypes';
import { formatWon, parseAmount } from '@/domain/money';
import { partiesFromInputs, partyRoleLabel } from '@/domain/parties';
import { matchUserParty } from '@/domain/partyMatch';
import type { ContractPayment, PartyRelation } from '@/domain/types';
import { useProfile, useSaveProfile } from '@/features/profile/queries';
import { colors, radius, spacing } from '@/theme';

import type { PaymentFormValues } from '../form';
import { FormLabel, type FormKit } from './kit';

type Choice = { role: string | null; relation: PartyRelation };

/** 폼 결제 → 계산용 결제 (빈 값은 없음으로) */
function paymentInputs(list: readonly PaymentFormValues[]): Pick<ContractPayment, 'label' | 'amount' | 'direction' | 'directionBasis' | 'moneyNature' | 'kind' | 'payerRole' | 'payeeRole'>[] {
  return list.map((p) => ({
    label: p.label,
    amount: parseAmount(p.amount) ?? 0,
    direction: p.direction,
    directionBasis: p.directionBasis || null,
    moneyNature: p.moneyNature || null,
    kind: p.kind,
    payerRole: p.payerRole || null,
    payeeRole: p.payeeRole || null,
  }));
}

const directionText = (d: DirectionChange['to']) => (d === 'neutral' ? '확인 필요' : DIRECTION_LABEL[d]);

export function RoleSection({ kit, kind }: { kit: FormKit; kind: string }) {
  const { values, setValue } = kit;
  const profile = useProfile();
  const saveProfile = useSaveProfile();
  const names = profile.data?.contractNames ?? [];
  const parties = useMemo(() => partiesFromInputs(values.parties ?? {}, values.partyTerms ?? {}), [values.parties, values.partyTerms]);
  const payments = useMemo(() => paymentInputs(values.payments ?? []), [values.payments]);
  const role = values.userPartyRole || null;
  const relation = (values.userPartyRelation || null) as PartyRelation | null;
  const ctx = { contractKind: values.contractKind || null, contractType: values.contractType, userPartyRole: role, userPartyRelation: relation, parties };
  const needs = needsRoleQuestion(ctx, payments, (values.funds ?? []).length > 0);
  // 추천 역할 (등록한 이름 일치 → 계약 종류상 보통 이쪽) — 추천일 뿐, 사용자가 눌러야 확정 (확정 전에는 합계에 넣지 않음)
  const rec = recommendedSide(ctx, names);
  const termOf = (r: string) => parties.find((p) => p.role === r && p.term)?.term ?? null;
  const match = matchUserParty(kind, parties, names);

  const [open, setOpen] = useState(false);
  const [onBehalf, setOnBehalf] = useState(false);
  const groups = useMemo(() => roleChoices(kind, parties, payments), [kind, parties, payments]);
  // 이미 고른 역할이 보조 선택지(중개업자 등)이거나 관리 중인 계약이면 "다른 경우"를 펼친 채로 (선택을 숨기지 않음)
  const [more, setMore] = useState(() => relation === 'on_behalf' || (!!role && groups.secondary.some((o) => o.role === role)));
  const [pending, setPending] = useState<{ choice: Choice; changes: DirectionChange[] } | null>(null);
  const [nameInput, setNameInput] = useState('');

  const showQuestion = (needs && !role) || open;
  // 고를 수 있는 당사자도 확정한 역할도 없으면 그리지 않는다. 그 밖에는 접혀 있어도 [역할 선택]을 항상 보여 준다
  if (!role && groups.primary.length === 0 && groups.secondary.length === 0) return null;

  const apply = (choice: Choice, changes: DirectionChange[]) => {
    setValue('userPartyRole', choice.role ?? '', { shouldDirty: true });
    setValue('userPartyRelation', choice.relation, { shouldDirty: true });
    for (const c of changes) {
      setValue(`payments.${c.index}.direction`, c.to, { shouldDirty: true });
      setValue(`payments.${c.index}.directionBasis`, c.basis ?? '', { shouldDirty: true });
    }
    setPending(null);
    setOpen(false);
    setOnBehalf(false);
  };
  const choose = (choice: Choice) => {
    const changes = roleDirectionChanges({ ...ctx, userPartyRole: choice.role, userPartyRelation: choice.relation }, payments);
    if (changes.length === 0) apply(choice, []);
    else setPending({ choice, changes });
  };

  // 선택지 표시: 계약서 당사자는 "역할 · 이름", 계약서에 이름이 없는 주요 역할은 역할 이름만
  const view = (o: RoleChoice) => {
    const i = o.partyIndex;
    if (i == null) return { ...o, label: parties.length > 0 ? `${partyRoleLabel(kind, o.role)} (계약서에 이름 없음)` : partyRoleLabel(kind, o.role), recommended: rec?.role === o.role };
    const p = parties[i];
    return {
      ...o,
      label: `${partyRoleLabel(kind, p.role, p.term)} · ${p.name}`,
      recommended: rec?.reason === 'name' ? match.status === 'match' && match.partyIndex === i : rec?.role === p.role && parties.findIndex((x) => x.role === p.role) === i,
    };
  };
  const primary = groups.primary.map(view);
  const secondary = groups.secondary.map(view);
  const showMore = more || primary.length === 0;
  const optionRow = (o: ReturnType<typeof view>) => (
    <RoleOption key={o.key} label={o.label} recommended={!onBehalf && o.recommended ? rec?.reason ?? 'name' : false} selected={pending?.choice.role === o.role} onPress={() => choose({ role: o.role, relation: onBehalf ? 'on_behalf' : 'self' })} testID={`role-option-${o.key}`} />
  );

  const current = role ? partyRoleLabel(kind, role, termOf(role)) : null;
  const recLabel = rec ? partyRoleLabel(kind, rec.role, termOf(rec.role)) : null;
  return (
    <View style={{ marginTop: spacing.md }} testID="role-section">
      <FormLabel label="이 계약에서 누구세요?" flagged={needs && !role && relation !== 'unknown'} />
      {!showQuestion ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }} testID="role-summary">
          <View style={{ flex: 1, flexShrink: 1, gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <AppText variant="body2" testID="role-current">
                {current ? `${relation === 'on_behalf' ? '관리하는 분' : '나'}: ${current}` : relation === 'unknown' ? '잘 모르겠어요로 두었어요' : '아직 역할을 정하지 않았어요'}
              </AppText>
              {current ? <Badge label="확정" tone="primary" /> : <Badge label="미정" tone="neutral" />}
            </View>
            {!current ? (
              <AppText variant="caption" color="textTertiary" testID="role-undetermined-note">
                방향을 정할 수 없는 금액은 확인 필요로 두고 합계에 넣지 않아요.
              </AppText>
            ) : null}
          </View>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" testID="role-change" hitSlop={8} style={{ flexShrink: 0, paddingVertical: spacing.xs }}>
            <AppText variant="captionStrong" color="primary">
              {current ? '변경' : '역할 선택'}
            </AppText>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginBottom: spacing.sm }} testID="role-question">
          <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.sm }}>
            {onBehalf ? '관리하는 분은 계약에서 어느 쪽인가요? 그분 기준으로 돈이 나가고 들어오는 것을 정리해요.' : '내 역할에 따라 돈이 나가는지 들어오는지, 보증금을 돌려받는지 돌려주는지가 달라져요.'}
          </AppText>
          {rec && recLabel && !onBehalf ? (
            <AppText variant="caption" color="primary" style={{ marginBottom: spacing.sm }} testID="role-recommendation">
              {rec.reason === 'name' ? `추천: ${recLabel} — 등록한 이름과 같은 당사자예요.` : `추천: ${recLabel} — 이 종류의 계약에서는 보통 이쪽이에요.`} 맞으면 눌러서 확인해주세요. 확인 전에는 합계에 넣지 않아요.
            </AppText>
          ) : null}
          {names.length === 0 && !profile.data?.contractNamesSkipped && parties.length > 0 && !onBehalf ? (
            <View style={{ backgroundColor: colors.bgSubtle, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }} testID="contract-name-prompt">
              <AppText variant="body2Strong">계약서에 사용되는 이름을 알려주세요.</AppText>
              <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.sm }}>
                계약서에서 본인을 찾고 계약상 역할을 확인하는 데 활용합니다. 이름만 저장하고, 계약서 분석(AI)에는 보내지 않아요.
              </AppText>
              <TextField label="이름" value={nameInput} onChangeText={setNameInput} placeholder="예: 홍길동" testID="contract-name-input" />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button label="이름 저장" size="sm" disabled={!nameInput.trim()} loading={saveProfile.isPending} onPress={() => saveProfile.mutate({ contractNames: [nameInput] })} testID="contract-name-save" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="건너뛰기" size="sm" variant="secondary" onPress={() => saveProfile.mutate({ skipContractNames: true })} testID="contract-name-skip" />
                </View>
              </View>
            </View>
          ) : null}
          {match.status === 'ambiguous' && !onBehalf ? (
            <AppText variant="caption" color="check" style={{ marginBottom: spacing.sm }} testID="role-ambiguous">
              등록한 이름이 여러 당사자에 나와 있어요. 직접 골라주세요.
            </AppText>
          ) : null}
          {primary.map(optionRow)}
          {onBehalf ? <RoleOption label="← 내 계약이에요" onPress={() => setOnBehalf(false)} testID="role-option-self" /> : null}
          {primary.length > 0 ? (
            <Pressable onPress={() => setMore((v) => !v)} accessibilityRole="button" aria-expanded={showMore} testID="role-more" style={{ paddingVertical: spacing.xs }}>
              <AppText variant="captionStrong" color="textSecondary">
                {showMore ? '다른 경우 접기 ▴' : '다른 경우 ▾'}
              </AppText>
            </Pressable>
          ) : null}
          {showMore ? (
            <View testID="role-more-options" style={{ marginTop: spacing.xs }}>
              {secondary.length > 0 ? (
                <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.xs }}>
                  {primary.length > 0 ? '돈을 직접 내거나 받지 않는 당사자예요. 계약서 당사자 정보에는 그대로 남아요.' : '계약서에 적힌 당사자예요.'}
                </AppText>
              ) : null}
              {secondary.map(optionRow)}
              {!onBehalf ? (
                <>
                  <RoleOption label="다른 사람의 계약을 관리하고 있어요" onPress={() => setOnBehalf(true)} testID="role-option-on-behalf" />
                  <RoleOption label="잘 모르겠어요 (나중에 정할게요)" selected={pending?.choice.relation === 'unknown'} onPress={() => choose({ role: null, relation: 'unknown' })} testID="role-option-unknown" />
                </>
              ) : null}
            </View>
          ) : null}
          {open && !pending ? (
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" testID="role-cancel" style={{ alignSelf: 'flex-end', paddingVertical: spacing.xs }}>
              <AppText variant="captionStrong" color="textSecondary">
                닫기
              </AppText>
            </Pressable>
          ) : null}
        </View>
      )}
      {pending ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }} testID="role-preview">
          <AppText variant="body2Strong" style={{ marginBottom: spacing.xs }}>
            이렇게 바뀌어요
          </AppText>
          {pending.changes.map((c) => (
            <AppText key={c.index} variant="caption" color="textSecondary" testID={`role-preview-${c.index}`}>
              {c.label} {formatWon(c.amount)}
              {c.nature === 'deposit' ? ' (보증금)' : ''}: {directionText(c.from)} → {directionText(c.to)}
            </AppText>
          ))}
          <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
            직접 고른 금액 구분은 바뀌지 않아요.
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="적용" size="sm" onPress={() => apply(pending.choice, pending.changes)} testID="role-apply" />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="취소" size="sm" variant="secondary" onPress={() => setPending(null)} testID="role-preview-cancel" />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoleOption({ label, recommended, selected, onPress, testID }: { label: string; recommended?: 'name' | 'contract' | false; selected?: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      aria-selected={!!selected}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.bgPressed : colors.bg,
        marginBottom: spacing.xs,
      })}>
      <AppText variant="body2" style={{ flex: 1 }}>
        {label}
      </AppText>
      {recommended ? <Badge label={recommended === 'name' ? '추천 · 등록한 이름과 같아요' : '추천'} tone="primary" /> : null}
    </Pressable>
  );
}
