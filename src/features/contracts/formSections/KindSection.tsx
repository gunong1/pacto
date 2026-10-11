/**
 * 계약 종류 섹션 — 종류 칩(13개, 한 번만 고름) · "+ 상세 분류"(그 종류의 상세 분류) · AI 판단 한 줄(확인 화면)
 * 입력: 현재 계약 종류·상세 분류, 기존 계약의 예전 표시 이름 / 출력: 사용자가 고른 종류·상세 분류 (onPickKind·onPickSubtype)
 * 정의는 공용 레지스트리 CONTRACT_KIND_DEFS 하나 (자동 분석·직접 입력 추천·수정 화면 공통). 내부 호환값(분야·관리 유형)은 보여주지 않는다.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, ChipGroup, RadioGroup } from '@/components/ui/controls';
import { classificationView, CONTRACT_KINDS, contractKindDef, contractKindLabel, contractSubtypeLabel, type KindClassification } from '@/domain/contractKinds';
import { hitSlop, spacing } from '@/theme';

import { styles } from './styles';

const KIND_OPTIONS = CONTRACT_KINDS.map((k) => ({ value: k.code, label: k.label }));

export function KindChooser({
  kind,
  subtype,
  legacyLabel,
  recommended,
  onPickKind,
  onPickSubtype,
}: {
  /** 선택된 계약 종류 (없으면 null — 고르기 전 또는 분류 개편 전 계약) */
  kind: string | null;
  subtype: string | null;
  /** 분류 개편 전 계약의 예전 표시 이름 (예: 자동차) — 종류를 고르면 새 분류로 저장 */
  legacyLabel: string | null;
  /** 계약명으로 추천한 상태 (사용자가 직접 고르기 전) */
  recommended: boolean;
  onPickKind: (code: string) => void;
  onPickSubtype: (code: string | null) => void;
}) {
  /** "상세 분류" 펼침 */
  const [subOpen, setSubOpen] = useState(false);
  const def = contractKindDef(kind);
  const subLabel = contractSubtypeLabel(kind, subtype);
  return (
    <View testID="kind-chooser">
      <ChipGroup options={KIND_OPTIONS} value={kind} onChange={onPickKind} testIDPrefix="kind" />
      <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }} testID="kind-hint">
        {def
          ? `${recommended ? '계약명으로 추천했어요 · ' : ''}${def.examples}`
          : legacyLabel
            ? `이전 분류: ${legacyLabel} — 종류를 고르면 새 분류로 저장돼요`
            : '이 계약이 무엇인지 골라주세요. 계약명을 입력하면 추천해요.'}
      </AppText>
      {def && def.subtypes.length > 0 ? (
        <>
          <Pressable onPress={() => setSubOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: subOpen }} hitSlop={hitSlop} testID="toggle-classification" style={styles.classToggle}>
            <AppText variant="captionStrong" color="primary">
              {subOpen ? '− 상세 분류 닫기' : '+ 상세 분류'}
            </AppText>
            {!subOpen && subLabel ? (
              <AppText variant="caption" color="textSecondary" testID="classification-custom">
                {subLabel}
              </AppText>
            ) : null}
          </Pressable>
          {subOpen ? (
            <View style={styles.classBox} testID="classification-detail">
              <AppText variant="caption" color="textTertiary">
                선택 사항이에요. 일정·지출 계산에는 영향이 없어요.
              </AppText>
              <ChipGroup
                options={def.subtypes.map((s) => ({ value: s.code, label: s.label }))}
                value={subtype}
                onChange={(v) => onPickSubtype(v === subtype ? null : v)}
                testIDPrefix="subtype"
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * 확인 화면: AI 판단 한 줄 — "구독·회원권 · 소프트웨어·SaaS · 신뢰도 높음"
 * 보통: "○○으로 분류했어요 · 아래에서 바꿀 수 있어요" + 다른 가능성 / 낮음: 후보 2개와 이유 — 골라야 최종 등록
 */
export function AiKindJudgment({ classification, picked, flagged, onPick }: { classification: KindClassification; picked: string | null; flagged?: boolean; onPick: (kind: string) => void }) {
  const v = classificationView(classification);
  return (
    <View style={[styles.suggestion, (flagged || v.needsChoice) && styles.suggestionFlagged]} testID="type-suggestion">
      <AppText variant="caption" color="textTertiary">
        AI 판단
      </AppText>
      <View style={styles.rowCenter}>
        <AppText variant="captionStrong" testID="ai-kind">
          {v.headline}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {v.confidenceLabel}
        </AppText>
        {v.needsChoice ? <Badge label="확인 필요" tone="check" /> : null}
      </View>
      {v.note ? (
        <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }} testID="ai-kind-note">
          {v.note} · 아래에서 바꿀 수 있어요
        </AppText>
      ) : null}
      {v.needsChoice ? (
        <View style={{ marginTop: spacing.sm }} testID="kind-candidates">
          <AppText variant="captionStrong">계약 종류를 확인해주세요</AppText>
          <RadioGroup
            options={v.candidates.map((k) => ({ value: k, label: contractKindLabel(k) }))}
            value={picked && v.candidates.includes(picked) ? picked : null}
            onChange={onPick}
            testIDPrefix="kind-candidate"
          />
        </View>
      ) : v.showAlternatives ? (
        <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }} testID="ai-kind-alternatives">
          다른 가능성: {v.alternativeLabels.join(', ')}
        </AppText>
      ) : null}
      {v.reason && classification.confidence !== 'high' ? (
        <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
          {v.reason}
        </AppText>
      ) : null}
    </View>
  );
}
