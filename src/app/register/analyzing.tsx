import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { aiProvider } from '@/data';
import { useRegistration } from '@/features/registration/store';
import { useToday } from '@/features/contracts/queries';
import { colors, spacing } from '@/theme';

/** 분석 중 정리하는 항목 — 기다리는 동안 PACTO가 무엇을 해주는지 보여준다. */
const FIELDS = ['계약명', '계약 기간', '결제일', '종료일', '자동갱신 여부', '해지 통보기한'];

/** "계약서를 확인하고 있습니다." — 분석 진행 화면. 완료 후 바로 저장하지 않고 확인 화면으로. */
export default function AnalyzingScreen() {
  const today = useToday();
  const files = useRegistration((s) => s.files);
  const setExtraction = useRegistration((s) => s.setExtraction);
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // 분석이 끝난 뒤(저장 후 초안 초기화 등) 다시 실행되지 않도록
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (files.length === 0) {
      router.replace('/register');
      return;
    }
    const controller = new AbortController();
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, FIELDS.length)), 330);
    aiProvider
      .extractContract({ files, today }, controller.signal)
      .then((result) => {
        done.current = true;
        setExtraction(result);
        router.replace('/register/review');
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => clearInterval(timer));
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [files, today, setExtraction, attempt]);

  if (failed) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <AppText variant="title2" align="center">
            계약서를 읽지 못했어요
          </AppText>
          <AppText variant="body2" color="textSecondary" align="center" style={{ marginTop: spacing.sm }}>
            사진이 흐리거나 지원하지 않는 형식일 수 있어요.
          </AppText>
        </View>
        <View style={styles.actions}>
          <Button
            label="다시 시도"
            onPress={() => {
              setFailed(false);
              setStep(0);
              setAttempt((a) => a + 1);
            }}
          />
          <Button label="직접 입력으로 계속하기" variant="secondary" onPress={() => router.replace('/register/manual')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} testID="analyzing">
      <View style={styles.body}>
        <ActivityIndicator size="large" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
        <AppText variant="title2" style={{ marginTop: spacing.xl }}>
          계약서를 확인하고 있어요.
        </AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          아래 정보를 정리하고 있습니다. 정리가 끝나면 저장 전에 직접 확인할 수 있어요.
        </AppText>
        <View style={styles.fields} testID="analyzing-fields">
          {FIELDS.map((f, i) => {
            const done = i < step;
            return (
              <View key={f} style={styles.field}>
                <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={done ? colors.primary : colors.textDisabled} />
                <AppText variant="body" color={done ? 'text' : 'textTertiary'}>
                  {f}
                </AppText>
              </View>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.xxl }}>
          {files.length === 1 ? files[0].name : `${files[0]?.name} 외 ${files.length - 1}장`}
        </AppText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.gutter },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.gutter + 4 },
  fields: { marginTop: spacing.xl, gap: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, gap: spacing.sm },
});
