/**
 * 계약 당사자 입력 — 등록 확인 · 직접 입력 · 계약 수정이 함께 쓴다 (역할 이름은 레지스트리, 규칙은 src/domain/parties.ts)
 * 입력: 계약 종류 · 역할별 이름(여럿이면 쉼표로) · 경로별 확인 필요/근거 / 출력: parties.<역할> · userPartyRole·userPartyRelation(RoleSection) · (예전 값이 있을 때만) counterparty
 * - 원래 있어야 하는 역할이 비어 있고 다른 쪽은 있으면 "확인 필요" (다른 쪽 이름으로 채우지 않음)
 * - 내 역할은 사용자가 고를 때만 (기본 모름)
 * - 예전 계약의 "계약 상대방"은 역할을 추측하지 않고 그대로 보여준다
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Section, SectionGap } from '@/components/ui/layout';
import { COUNTERPARTY_LABEL } from '@/domain/parties';

import { partyRoleDef, partyRolesOf } from '../../../../supabase/functions/_shared/contractRegistry';
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
          const path = `parties.${role}`;
          const missing = def.main && !filled(role) && anyName;
          return (
            <View key={`${kind}-${role}`}>
              {kit.field(path as FieldName, def.label, {
                placeholder: missing ? '확인 필요' : '이름 또는 회사명',
                flagged: kit.flagged?.has(path) || missing,
                hint: kit.hint(path) ?? (missing ? '계약서에서 이 당사자를 확인해주세요.' : undefined),
              })}
            </View>
          );
        })}
        {legacyCounterparty ? kit.field('counterparty', COUNTERPARTY_LABEL, { placeholder: '예: 삼성화재' }) : null}
        {/* 내 역할: 추천(등록한 이름) → 사용자가 확정 → 변경 예정 금액 미리보기 후 적용 */}
        <RoleSection kit={kit} kind={kind} />
      </Section>
    </>
  );
}
