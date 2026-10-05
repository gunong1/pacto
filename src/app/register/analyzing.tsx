import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { aiProvider, documentStore } from '@/data';
import { DocumentError } from '@/data/documents';
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
  const setUploaded = useRegistration((s) => s.setUploaded);
  const [phase, setPhase] = useState<'upload' | 'analyze'>('upload');
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState<null | { title: string; message: string; uploadFailed: boolean }>(null);
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
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      // ① 원본 보관: 비공개 저장소에 먼저 올린다 (분석이 실패해도 원본은 남는다)
      let docs = useRegistration.getState().uploaded;
      if (docs.length < files.length) {
        try {
          docs = [];
          for (let i = 0; i < files.length; i++) docs.push(await documentStore.upload(files[i], { sortOrder: i }));
          setUploaded(docs);
        } catch (e) {
          if (docs.length > 0) documentStore.discard(docs.map((d) => d.id)).catch(() => undefined);
          if (!controller.signal.aborted) {
            setFailed({ title: '계약서를 보관하지 못했어요', message: e instanceof DocumentError ? e.message : '네트워크를 확인하고 다시 시도해주세요.', uploadFailed: true });
          }
          return;
        }
      }
      if (controller.signal.aborted) return;
      // ② 계약정보 정리 (Step 9 전까지 mock)
      setPhase('analyze');
      timer = setInterval(() => setStep((v) => Math.min(v + 1, FIELDS.length)), 330);
      try {
        const result = await aiProvider.extractContract({ files, today }, controller.signal);
        done.current = true;
        setExtraction(result);
        router.replace('/register/review');
      } catch {
        if (!controller.signal.aborted) {
          setFailed({ title: '계약서를 읽지 못했어요', message: '원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.', uploadFailed: false });
        }
      } finally {
        clearInterval(timer);
      }
    })();
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [files, today, setExtraction, setUploaded, attempt]);

  if (failed) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <AppText variant="title2" align="center">
            {failed.title}
          </AppText>
          <AppText variant="body2" color="textSecondary" align="center" style={{ marginTop: spacing.sm }}>
            {failed.message}
          </AppText>
        </View>
        <View style={styles.actions}>
          <Button
            label="다시 시도"
            onPress={() => {
              setFailed(null);
              setStep(0);
              setPhase('upload');
              setAttempt((a) => a + 1);
            }}
          />
          {!failed.uploadFailed ? <Button label="직접 입력으로 계속하기" variant="secondary" onPress={() => router.replace('/register/manual')} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} testID="analyzing">
      <View style={styles.body}>
        <ActivityIndicator size="large" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
        <AppText variant="title2" style={{ marginTop: spacing.xl }}>
          {phase === 'upload' ? '계약서를 안전하게 보관하고 있어요.' : '계약서를 확인하고 있어요.'}
        </AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          {phase === 'upload'
            ? '원본은 본인만 열람할 수 있는 비공개 저장소에 보관됩니다.'
            : '아래 정보를 정리하고 있습니다. 정리가 끝나면 저장 전에 직접 확인할 수 있어요.'}
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
