/**
 * 계약 종류 섹션 — 종류 칩(한 번만 고름) · "+ 상세 분류"(계약 구조·분야 직접 선택) · AI 판단 안내(확인 화면)
 * 입력: 현재 유형·분야, 추천 여부 / 출력: 사용자가 고른 종류·유형·분야 (onPickKind·onPickType·onPickCategory)
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, ChipGroup } from '@/components/ui/controls';
import { contractTypeLabel, CONTRACT_TYPES, type ContractType } from '@/domain/contractTypes';
import { CONTRACT_KINDS, kindOf } from '@/domain/contractKinds';
import { categoryLabel } from '@/domain/labels';
import { CONTRACT_CATEGORIES, type Confidence, type ContractCategory } from '@/domain/types';
import { hitSlop, spacing } from '@/theme';

import { FormLabel } from './kit';
import { styles } from './styles';

export interface TypeSuggestionView {
  value: ContractType;
  confidence: Confidence;
  alternatives: ContractType[];
  reason: string | null;
}
export interface CategorySuggestionView {
  value: string;
  confidence: Confidence;
  alternatives: string[];
  reason: string | null;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };
const CATEGORY_OPTIONS = CONTRACT_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }));
const TYPE_OPTIONS = CONTRACT_TYPES.map((t) => ({ value: t, label: contractTypeLabel(t) }));
const KIND_OPTIONS = CONTRACT_KINDS.map((k) => ({ value: k.code, label: k.label }));

export function KindChooser({
  type,
  category,
  selectedKind,
  recommended,
  flagged,
  onPickKind,
  onPickType,
  onPickCategory,
}: {
  type: ContractType;
  category: ContractCategory;
  /** 선택된 종류 코드 (새 직접 입력은 고르거나 추천되기 전까지 null) */
  selectedKind: string | null;
  /** 계약명으로 추천한 상태 (사용자가 직접 고르기 전) */
  recommended: boolean;
  flagged?: ReadonlySet<string>;
  onPickKind: (code: string) => void;
  onPickType: (t: ContractType) => void;
  onPickCategory: (c: ContractCategory) => void;
}) {
  /** "상세 분류" (내부 유형·분야 직접 선택) 펼침 */
  const [classOpen, setClassOpen] = useState(false);
  const match = kindOf(type, category);
  return (
    <View testID="kind-chooser">
      <ChipGroup options={KIND_OPTIONS} value={selectedKind} onChange={onPickKind} testIDPrefix="kind" />
      <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }} testID="kind-hint">
        {selectedKind ? `${recommended ? '계약명으로 추천했어요 · ' : ''}${match.kind.examples}` : '이 계약이 무엇인지 골라주세요. 계약명을 입력하면 추천해요.'}
      </AppText>
      <Pressable onPress={() => setClassOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: classOpen }} hitSlop={hitSlop} testID="toggle-classification" style={styles.classToggle}>
        <AppText variant="captionStrong" color="primary">
          {classOpen ? '− 상세 분류 닫기' : '+ 상세 분류'}
        </AppText>
        {!match.exact ? (
          <AppText variant="caption" color="textSecondary" testID="classification-custom">
            {contractTypeLabel(type)} · {categoryLabel(category)}
          </AppText>
        ) : null}
      </Pressable>
      {classOpen ? (
        <View style={styles.classBox} testID="classification-detail">
          <AppText variant="caption" color="textTertiary">
            애매한 계약만 바꿔주세요. 계약 구조는 일정·지출 계산 방식, 분야는 지출 분류에 쓰여요.
          </AppText>
          <FormLabel label="계약 구조" flagged={flagged?.has('contractType')} />
          <ChipGroup options={TYPE_OPTIONS} value={type} onChange={onPickType} testIDPrefix="type" />
          <FormLabel label="분야" flagged={flagged?.has('category')} />
          <ChipGroup options={CATEGORY_OPTIONS} value={category} onChange={onPickCategory} testIDPrefix="category" />
        </View>
      ) : null}
    </View>
  );
}

/** 확인 화면: AI가 판단한 종류·분야와 신뢰도 (확정하지 않음 — 아래 종류 칩에서 바꿀 수 있다) */
export function TypeSuggestionBox({
  typeSuggestion,
  categorySuggestion,
  category,
  flagged,
}: {
  typeSuggestion: TypeSuggestionView;
  categorySuggestion?: CategorySuggestionView;
  category: ContractCategory;
  flagged?: ReadonlySet<string>;
}) {
  return (
    <View style={[styles.suggestion, flagged?.has('contractType') && styles.suggestionFlagged]} testID="type-suggestion">
      {categorySuggestion ? (
        <View style={styles.rowCenter}>
          <AppText variant="captionStrong" testID="category-suggestion">
            AI 판단 분야: {categoryLabel(categorySuggestion.value)} · 신뢰도 {CONFIDENCE_LABEL[categorySuggestion.confidence]} (상세 분류)
          </AppText>
          {flagged?.has('category') ? <Badge label="확인 필요" tone="check" /> : null}
        </View>
      ) : null}
      <View style={styles.rowCenter}>
        <AppText variant="captionStrong">
          AI 판단 종류: {kindOf(typeSuggestion.value, (categorySuggestion?.value ?? category) as ContractCategory).kind.label} · 신뢰도 {CONFIDENCE_LABEL[typeSuggestion.confidence]}
        </AppText>
        {flagged?.has('contractType') ? <Badge label="확인 필요" tone="check" /> : null}
      </View>
      {typeSuggestion.reason ? (
        <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
          {typeSuggestion.reason}
        </AppText>
      ) : null}
      {typeSuggestion.alternatives.length > 0 ? (
        <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
          다른 가능성: {[...new Set(typeSuggestion.alternatives.map((t) => kindOf(t, category).kind.label))].join(', ')}
        </AppText>
      ) : null}
      <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
        종류에 따라 일정·지출·확인할 조건이 다르게 만들어져요. 맞지 않으면 아래에서 바꿔주세요.
      </AppText>
    </View>
  );
}
