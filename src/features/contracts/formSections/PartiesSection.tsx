/**
 * 계약 당사자 입력 — 등록 확인 · 직접 입력 · 계약 수정이 함께 쓴다 (역할 이름은 레지스트리, 규칙은 src/domain/parties.ts)
 * 입력: 계약 종류 · 역할별 이름(여럿이면 쉼표로) · 경로별 확인 필요/근거 / 출력: parties.<역할> · userPartyRole·userPartyRelation(RoleSection) · (예전 값이 있을 때만) counterparty
 * - 원래 있어야 하는 역할이 비어 있고 다른 쪽은 있으면 "확인 필요" (다른 쪽 이름으로 채우지 않음)
 * - 내 역할은 사용자가 고를 때만 (기본 모름)
 * - 예전 계약의 "계약 상대방"은 역할을 추측하지 않고 그대로 보여준다
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Section, SectionGap } from '@/components/ui/layout';
import { COUNTERPARTY_LABEL, partiesFromInputs, partyRoleLabel } from '@/domain/parties';
import { colors, radius, spacing } from '@/theme';

import { normalizePartyRoles, partyRoleDef, partyRolesOf, ROLE_EQUIVALENTS, samePartyName } from '../../../../supabase/functions/_shared/contractRegistry';
import { type FieldName, type FormKit } from './kit';
import { RoleSection } from './RoleSection';

export function PartiesSection({ kit, kind }: { kit: FormKit; kind: string }) {
  const inputs = (kit.values.parties ?? {}) as Record<string, string | undefined>;
  const filled = (role: string) => !!inputs[role]?.trim();
  // 그 종류의 역할 + 다른 종류에서 온 값(종류를 바꾼 경우 — 지우지 않고 그 역할 이름으로 보여줌)
  const roles = [...partyRolesOf(kind).map((r) => r.code), ...Object.keys(inputs).filter(filled)];
  const shown = roles.filter((r, i) => roles.indexOf(r) === i);
  const anyName = shown.some(filled);
  // 예전 계약의 상대방 이름 — 값이 있던 계약에서만 보여준다 (새 계약은 역할별로)
  const [legacyCounterparty] = useState(() => !!kit.values.counterparty?.trim());

  return (
    <>
      <SectionGap />
      <Section title="계약 당사자" caption="계약서에 적힌 이름 그대로. 여러 명이면 쉼표로 나눠 적어주세요." testID="section-parties">
        {shown.map((role) => {
          const def = partyRoleDef(kind, role);
          const label = partyRoleLabel(kind, role, kit.values.partyTerms?.[role]);
          const path = `parties.${role}`;
          const missing = def.main && !filled(role) && anyName;
          return (
            <View key={`${kind}-${role}`}>
              {kit.field(path as FieldName, label, {
                placeholder: missing ? '확인 필요' : '이름 또는 회사명',
                flagged: kit.flagged?.has(path) || missing,
                hint: kit.hint(path) ?? (missing ? '계약서에서 이 당사자를 확인해주세요.' : undefined),
              })}
            </View>
          );
        })}
        <PartyConflicts kit={kit} kind={kind} />
        {legacyCounterparty ? kit.field('counterparty', COUNTERPARTY_LABEL, { placeholder: '예: 삼성화재' }) : null}
        {/* 내 역할: 추천(등록한 이름) → 사용자가 확정 → 변경 예정 금액 미리보기 후 적용 */}
        <RoleSection kit={kit} kind={kind} />
      </Section>
    </>
  );
}

/**
 * 같은 자리에 두 이름 (예: 렌탈회사 칸 "팩토렌트카" ↔ 계약서의 임대인 "주식회사 팩토렌터카")
 * - 표기만 다르면(띄어쓰기·(주)/주식회사) 같은 당사자 — 칸에 있던 이름을 그대로 두고 알려만 준다
 * - 실제로 다른 이름이면 덮어쓰지 않고 두 후보와 계약서 근거를 보여주고 사용자가 고른다
 */
function PartyConflicts({ kit, kind }: { kit: FormKit; kind: string }) {
  const inputs = (kit.values.parties ?? {}) as Record<string, string | undefined>;
  const terms = (kit.values.partyTerms ?? {}) as Record<string, string | undefined>;
  const distinct = (kit.values.partyDistinct ?? []) as string[];
  const parties = partiesFromInputs(inputs, terms, distinct);
  const eq = ROLE_EQUIVALENTS[kind] ?? {};
  const conflicts = normalizePartyRoles(kind, parties).conflicts;
  const setDistinct = (next: string[]) => kit.setValue('partyDistinct' as never, next as never, { shouldDirty: true });
  // 표기만 다른 같은 이름 (저장할 때 칸의 이름으로 합쳐짐)
  const sameNotation = Object.entries(eq).flatMap(([from, to]) =>
    parties.filter((p) => p.role === from).flatMap((p) => parties.filter((d) => d.role === to && d.name !== p.name && samePartyName(d.name, p.name)).map((d) => ({ from, to, doc: p.name, kept: d.name }))),
  );
  const choose = (from: string, to: string, useDoc: boolean) => {
    if (useDoc) {
      kit.setValue(`parties.${to}` as never, inputs[from] as never, { shouldDirty: true });
      kit.setValue('partyTerms' as never, { ...terms, [to]: partyRoleDef(null, from).label } as never, { shouldDirty: true });
    }
    kit.setValue(`parties.${from}` as never, '' as never, { shouldDirty: true });
  };
  const separate = distinct.filter((r) => eq[r] && inputs[r]?.trim());
  if (conflicts.length === 0 && sameNotation.length === 0 && separate.length === 0) return null;
  return (
    <View testID="party-conflicts">
      {sameNotation.map((x) => (
        <AppText key={`${x.from}-${x.doc}`} variant="caption" color="textTertiary" style={{ marginBottom: spacing.sm }} testID={`party-same-${x.from}`}>
          계약서의 {partyRoleDef(null, x.from).label} &quot;{x.doc}&quot;는 {partyRoleLabel(kind, x.to)} &quot;{x.kept}&quot;와 표기만 달라 같은 당사자로 봤어요 (입력된 이름 유지).
        </AppText>
      ))}
      {separate.map((r) => (
        <View key={`sep-${r}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }} testID={`party-separate-${r}`}>
          <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
            {partyRoleDef(null, r).label} &quot;{inputs[r]}&quot;는 {partyRoleLabel(kind, eq[r])}와 다른 당사자로 따로 둬요. 금액 방향은 계약서의 지급자·수령자 그대로예요.
          </AppText>
          <Pressable onPress={() => setDistinct(distinct.filter((x) => x !== r))} accessibilityRole="button" testID={`party-separate-undo-${r}`}>
            <AppText variant="captionStrong" color="primary">
              되돌리기
            </AppText>
          </Pressable>
        </View>
      ))}
      {conflicts.map((from) => {
        const to = eq[from];
        const toLabel = partyRoleLabel(kind, to);
        const fromLabel = partyRoleDef(null, from).label;
        const toFromDoc = !!kit.evidence?.[`parties.${to}`];
        return (
          <View key={from} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }} testID={`party-conflict-${from}`}>
            <AppText variant="body2Strong" style={{ marginBottom: spacing.xs }}>
              {toLabel} 이름이 두 가지예요. 어느 쪽이 맞나요?
            </AppText>
            <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.sm }}>
              다른 이름이라 자동으로 바꾸지 않았어요. 같은 회사의 다른 이름이면 표시할 이름 하나를 고르고, 정말 서로 다른 당사자면 아래에서 따로 두세요.
            </AppText>
            <Candidate label={toFromDoc ? `계약서의 ${toLabel}` : `${toLabel} 칸에 입력된 이름`} name={inputs[to] ?? ''} evidence={kit.evidenceIcon(`parties.${to}`, toLabel)} onPick={() => choose(from, to, false)} testID={`party-conflict-keep-${from}`} />
            <Candidate label={`계약서의 ${fromLabel}`} name={inputs[from] ?? ''} evidence={kit.evidenceIcon(`parties.${from}`, fromLabel)} onPick={() => choose(from, to, true)} testID={`party-conflict-doc-${from}`} />
            <Pressable onPress={() => setDistinct([...distinct, from])} accessibilityRole="button" testID={`party-conflict-both-${from}`} style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
              <AppText variant="captionStrong" color="textSecondary">
                서로 다른 당사자예요 ({toLabel}와 {fromLabel}를 따로 두기)
              </AppText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function Candidate({ label, name, evidence, onPick, testID }: { label: string; name: string; evidence: React.ReactNode; onPick: () => void; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <AppText variant="caption" color="textTertiary">
            {label}
          </AppText>
          {evidence}
        </View>
        <AppText variant="body2Strong">{name}</AppText>
      </View>
      <Button label="이 이름으로" size="sm" variant="secondary" onPress={onPick} testID={testID} />
    </View>
  );
}
