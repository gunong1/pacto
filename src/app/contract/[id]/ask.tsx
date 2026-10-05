import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { Screen, Section } from '@/components/ui/layout';
import { colors, radius, spacing } from '@/theme';

const EXAMPLES = ['지금 해지하면 어떻게 돼?', '자동갱신이야?', '다음 결제일 언제야?', '보증금은 얼마야?'];

/**
 * 이 계약에 질문하기 — P2. V1은 진입점과 화면 자리만.
 * TODO(P2): AIProvider.answerQuestion → { answer, citations: [{ documentId, page, quote }] } 형태로
 *           원문 근거와 함께 답변 (Edge Function `ask-contract`).
 */
export default function AskContractScreen() {
  return (
    <Screen edges={['bottom']}>
      <Section>
        <Badge label="준비중" />
        <AppText variant="title2" style={{ marginTop: spacing.md }}>
          계약서에 근거해서 답해 드릴게요
        </AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          이 계약서 내용만 바탕으로 답하고, 답변마다 원문 위치를 함께 보여드릴 예정이에요.
        </AppText>
        <View style={styles.examples}>
          {EXAMPLES.map((q) => (
            <View key={q} style={styles.example}>
              <AppText variant="body2" color="textSecondary">
                {q}
              </AppText>
            </View>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  examples: { marginTop: spacing.xl, gap: spacing.sm },
  example: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
});
