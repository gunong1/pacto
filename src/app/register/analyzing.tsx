import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { aiProvider, documentStore } from '@/data';
import { AIConsentRequiredError, AIExtractionError } from '@/data/ai/provider';
import { DocumentError } from '@/data/documents';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { useRegistration } from '@/features/registration/store';
import { useToday } from '@/features/contracts/queries';
import { confirm } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

/**
 * 진행 단계 — 실제 처리 순서와 같다 (가짜 진행률을 만들지 않는다).
 * ① 계약서 보관 → ② 민감정보 보호(서버, 외부 전송 없음) → ③ 계약 내용 분석(AI) → ④ 계약정보 정리
 * 분석은 한 번의 요청이라 세부 진행률을 알 수 없어, 분석 중에는 무엇을 보고 있는지만 안내 문구로 바꿔 보여준다(완료 표시 아님).
 */
const PHASES = [
  { key: 'upload', label: '계약서 보관' },
  { key: 'protect', label: '민감정보 보호' },
  { key: 'analyze', label: '계약 내용 분석' },
  { key: 'done', label: '계약정보 정리' },
] as const;
type Phase = (typeof PHASES)[number]['key'];
const ANALYZE_MESSAGES = [
  '어떤 계약인지 확인하고 있어요.',
  '중요한 날짜를 찾고 있어요.',
  '금액과 납입 구조를 정리하고 있어요.',
  '계약 기간과 종료 조건을 확인하고 있어요.',
  '주의해서 볼 조건이 있는지 확인하고 있어요.',
  '저장 전에 확인할 내용을 정리하고 있어요.',
] as const;
/** 안내 문구 전환 간격 (ms) */
const STAGE_MS = 2600;

/** "계약서를 확인하고 있습니다." — 분석 진행 화면. 완료 후 바로 저장하지 않고 확인 화면으로. */
export default function AnalyzingScreen() {
  const today = useToday();
  const files = useRegistration((s) => s.files);
  const setExtraction = useRegistration((s) => s.setExtraction);
  const setUploaded = useRegistration((s) => s.setUploaded);
  const [phase, setPhase] = useState<Phase>('upload');
  const [protectedCount, setProtectedCount] = useState<number | null>(null);
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
      // ② 민감정보 보호: 원본은 그대로 두고 서버가 보호 표시본을 만든다 (외부 전송 없음). 실패해도 분석은 계속한다
      if (documentStore.mode === 'supabase') setPhase('protect');
      try {
        const results = await Promise.all(docs.map((d) => documentStore.protect(d.id).catch(() => null)));
        if (documentStore.mode === 'supabase') {
          const prot = await documentStore.getProtection(docs.map((d) => d.id)).catch(() => ({}) as Record<string, never>);
          setProtectedCount(results.some((r) => r?.status === 'protected') ? Object.values(prot).reduce((n, p) => n + p.regions.filter((g) => g.state === 'masked').length, 0) : null);
        }
      } catch {
        // 보호 실패는 문서 상태(failed)로 남고, 화면에서 다시 시도할 수 있다
      }
      if (controller.signal.aborted) return;
      // ③ 계약 내용 분석
      setPhase('analyze');
      setStep(0);
      timer = setInterval(() => setStep((v) => Math.min(v + 1, ANALYZE_MESSAGES.length - 1)), STAGE_MS);
      const extract = () => aiProvider.extractContract({ files, documentIds: docs.map((d) => d.id), today }, controller.signal);
      try {
        let result;
        try {
          result = await extract();
        } catch (e) {
          if (!(e instanceof AIConsentRequiredError)) throw e;
          // 개인정보 보호: 계약서를 외부 AI로 보내기 전에 동의를 받는다
          const ok = await confirm(
            '계약서 자동 정리 동의',
            '계약서 내용을 자동으로 정리하기 위해 원본을 외부 AI 서비스(OpenAI)로 전송해 처리합니다. 처리 결과는 저장 전에 직접 확인할 수 있어요. 동의하시겠어요?',
            '동의',
          );
          if (!ok) {
            if (!controller.signal.aborted) router.replace('/register/manual');
            return;
          }
          if (aiProvider instanceof SupabaseAIProvider) await aiProvider.grantConsent();
          result = await extract();
        }
        if (controller.signal.aborted) return;
        done.current = true;
        clearInterval(timer);
        setPhase('done');
        setExtraction(result);
        // 완료 문구를 잠깐 보여준 뒤 확인 화면으로
        await new Promise((r) => setTimeout(r, 700));
        if (!controller.signal.aborted) router.replace('/register/review');
      } catch (e) {
        if (!controller.signal.aborted) {
          setFailed({
            title: '계약서를 자동으로 정리하지 못했어요',
            message: e instanceof AIExtractionError ? e.message : '원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.',
            uploadFailed: false,
          });
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

  const title =
    phase === 'upload' ? '계약서를 안전하게 보관하고 있어요.' : phase === 'protect' ? '민감정보를 찾고 있어요.' : phase === 'done' ? '계약정보 정리가 완료됐어요.' : '계약서를 확인하고 있어요.';
  const subtitle =
    phase === 'upload'
      ? '원본은 본인만 열람할 수 있는 비공개 저장소에 보관됩니다.'
      : phase === 'protect'
        ? '원본은 그대로 두고, 주민등록번호·계좌번호 등을 가린 보호본을 따로 만들어요.'
        : phase === 'done'
          ? '저장하기 전에 내용을 한 번 확인해주세요.'
          : '이 계약에서 꼭 관리해야 할 날짜와 금액, 주요 조건을 정리하고 있어요.';
  // 미리보기(mock) 모드는 보호 처리를 하지 않으므로 그 단계를 보여주지 않는다
  const phases = documentStore.mode === 'supabase' ? PHASES : PHASES.filter((p) => p.key !== 'protect');
  const phaseIndex = phases.findIndex((p) => p.key === phase);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} testID="analyzing">
      <View style={styles.body}>
        {phase === 'done' ? (
          <Ionicons name="checkmark-circle" size={40} color={colors.primary} />
        ) : (
          <ActivityIndicator size="large" color={colors.primary} style={{ alignSelf: 'flex-start' }} />
        )}
        <AppText variant="title2" style={{ marginTop: spacing.xl }} testID="analyzing-title">
          {title}
        </AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          {subtitle}
        </AppText>
        <View style={styles.fields} testID="analyzing-stages">
          {phases.map((s, i) => {
            const state = i < phaseIndex || phase === 'done' ? 'done' : i === phaseIndex ? 'active' : 'todo';
            return (
              <View key={s.key} style={styles.field} testID={`analyzing-phase-${s.key}`}>
                  {state === 'active' ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ width: 20 }} />
                  ) : (
                    <Ionicons name={state === 'done' ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={state === 'done' ? colors.primary : colors.textDisabled} />
                  )}
                  <AppText variant="body" color={state === 'todo' ? 'textTertiary' : 'text'}>
                    {s.label}
                    {s.key === 'protect' && state === 'done' && protectedCount ? ` · ${protectedCount}건 가림` : ''}
                  </AppText>
              </View>
            );
          })}
        </View>
        {phase === 'analyze' ? (
          <AppText variant="body2Strong" color="primary" style={{ marginTop: spacing.lg }} testID="analyzing-stage-message">
            {ANALYZE_MESSAGES[Math.min(step, ANALYZE_MESSAGES.length - 1)]}
          </AppText>
        ) : null}
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
