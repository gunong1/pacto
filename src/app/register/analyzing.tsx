import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { aiProvider, documentStore } from '@/data';
import {
  AIConsentRequiredError,
  AIExtractionError,
  type AnalysisChoice,
  type AnalysisOutcome,
  type DocumentValidation,
  type ExtractInput,
  type PickedFile,
} from '@/data/ai/provider';
import { DocumentError, type UploadedDocument } from '@/data/documents';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { useToday } from '@/features/contracts/queries';
import { ensureCameraPermission, openAppSettings } from '@/features/registration/camera';
import { checkPhotos, pickPhotos } from '@/features/registration/pickers';
import { useRegistration } from '@/features/registration/store';
import { confirm } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 진행 단계 — 실제 처리 순서와 같다 (가짜 진행률을 만들지 않는다).
 * ① 계약서 보관 → ② 민감정보 보호(서버, 외부 전송 없음) → ③ 문서 확인·계약 분석(AI 1회) → ④ 계약정보 정리
 * ③은 한 번의 요청에서 "계약 관련 문서인지"와 계약 내용을 함께 본다. 통과하지 못하면 확인 화면으로 가지 않는다.
 */
const PHASES = [
  { key: 'upload', label: '계약서 보관' },
  { key: 'protect', label: '민감정보 보호' },
  { key: 'analyze', label: '문서 확인·계약 분석' },
  { key: 'done', label: '계약정보 정리' },
] as const;
type Phase = (typeof PHASES)[number]['key'];
const ANALYZE_MESSAGES = [
  '계약 관련 문서인지 확인하고 있어요.',
  '어떤 계약인지 확인하고 있어요.',
  '중요한 날짜와 금액을 찾고 있어요.',
  '계약 기간과 종료 조건을 확인하고 있어요.',
  '주요 조건을 정리하고 있어요.',
] as const;
const STAGE_MS = 2600;

type Gate =
  | { kind: 'failed'; title: string; message: string; uploadFailed: boolean }
  | { kind: 'stop'; decision: 'stop_non_contract' | 'stop_unreadable' | 'stop_insufficient'; lowResolution?: number[] }
  | { kind: 'confirm'; validation: DocumentValidation }
  | { kind: 'pages'; validation: DocumentValidation; confirmRole: boolean };

const UNREADABLE_CAUSES = ['흔들림', '너무 어두움', '문서 일부가 잘림', '해상도 부족'];

/** "계약서를 확인하고 있습니다." — 보관 → 보호 → 문서 확인·분석. 계약 관련 문서로 확인된 경우에만 확인 화면으로. */
export default function AnalyzingScreen() {
  const today = useToday();
  const files = useRegistration((s) => s.files);
  const photoSource = useRegistration((s) => s.photoSource);
  const setExtraction = useRegistration((s) => s.setExtraction);
  const setUploaded = useRegistration((s) => s.setUploaded);
  const [phase, setPhase] = useState<Phase>('upload');
  const [protectedCount, setProtectedCount] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [gate, setGate] = useState<Gate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const jobId = useRef<string | undefined>(undefined);
  const done = useRef(false);

  const input = (): ExtractInput => {
    const s = useRegistration.getState();
    return { files: s.files, documentIds: s.uploaded.map((d) => d.id), today };
  };

  /** 등록을 이어가지 않을 때: 보관한 원본·보호본을 지운다 (계약에 연결되지 않은 것만) */
  const discardUploads = () => {
    const { uploaded } = useRegistration.getState();
    if (uploaded.length) documentStore.discard(uploaded.map((d) => d.id)).catch(() => undefined);
    setUploaded([]);
  };

  /** 마무리에서 제외된 사진: 보관본을 지우고 목록에서 뺀다 */
  const dropExcluded = (excluded: number[] | undefined) => {
    if (!excluded?.length) return;
    const s = useRegistration.getState();
    const gone = excluded.map((f) => s.uploaded[f - 1]).filter((d): d is UploadedDocument => !!d);
    if (gone.length) documentStore.discard(gone.map((d) => d.id)).catch(() => undefined);
    const keep = (_: unknown, i: number) => !excluded.includes(i + 1);
    s.setUploaded(s.uploaded.filter(keep));
    s.setFiles(s.files.filter(keep));
  };

  /** 판정에 따라 다음 화면 */
  const handle = async (outcome: AnalysisOutcome) => {
    jobId.current = outcome.jobId ?? jobId.current;
    const v = outcome.validation;
    switch (v.decision) {
      case 'proceed':
        if (!outcome.result) throw new AIExtractionError('계약서를 자동으로 정리하지 못했어요.');
        done.current = true;
        dropExcluded(outcome.excludedFiles);
        setPhase('done');
        setExtraction(outcome.result, v);
        await new Promise((r) => setTimeout(r, 700));
        router.replace('/register/review');
        return;
      case 'confirm_role':
        setGate({ kind: 'confirm', validation: v });
        return;
      case 'choose_pages':
        setGate({ kind: 'pages', validation: v, confirmRole: false });
        return;
      default:
        // 계약이 아니거나 읽기 어렵거나 정보가 부족 — 분석 중단, 보관본 정리, 계약·일정·알림을 만들지 않는다
        discardUploads();
        setGate({ kind: 'stop', decision: v.decision });
    }
  };

  const runFinalize = async (choice: AnalysisChoice) => {
    setGate(null);
    setPhase('analyze');
    try {
      await handle(await aiProvider.finalize(jobId.current, choice, input()));
    } catch (e) {
      setGate({ kind: 'failed', title: '계약서를 자동으로 정리하지 못했어요', message: e instanceof AIExtractionError ? e.message : '원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.', uploadFailed: false });
    }
  };

  useEffect(() => {
    if (done.current) return;
    if (files.length === 0) {
      router.replace('/register');
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      // ⓪ 업로드 전 사진 점검 (AI 비용 없음): 같은 사진은 한 번만, 너무 작은 사진은 다시 촬영 안내 (서버에 파일을 남기지 않음)
      if (useRegistration.getState().uploaded.length === 0) {
        const check = checkPhotos(files);
        if (check.lowResolution.length > 0) {
          setGate({ kind: 'stop', decision: 'stop_unreadable', lowResolution: check.lowResolution.map((i) => i + 1) });
          return;
        }
        if (check.duplicates.length > 0) {
          setNotice(`같은 사진 ${check.duplicates.length}장은 한 번만 올렸어요.`);
          useRegistration.getState().setFiles(files.filter((_, i) => !check.duplicates.includes(i)));
          return; // files가 바뀌면 다시 실행된다
        }
      }
      // ① 원본 보관
      let docs = useRegistration.getState().uploaded;
      if (docs.length < files.length) {
        try {
          docs = [];
          for (let i = 0; i < files.length; i++) docs.push(await documentStore.upload(files[i], { sortOrder: i }));
          setUploaded(docs);
        } catch (e) {
          if (docs.length > 0) documentStore.discard(docs.map((d) => d.id)).catch(() => undefined);
          if (!controller.signal.aborted) {
            setGate({ kind: 'failed', title: '계약서를 보관하지 못했어요', message: e instanceof DocumentError ? e.message : '사진을 열 수 없거나 네트워크에 문제가 있어요. 다른 파일을 선택하거나 다시 시도해주세요.', uploadFailed: true });
          }
          return;
        }
      }
      if (controller.signal.aborted) return;
      // ② 민감정보 보호 (사진은 자동 가리기 미지원 — 상태만 기록)
      if (documentStore.mode === 'supabase') setPhase('protect');
      try {
        const results = await Promise.all(docs.map((d) => documentStore.protect(d.id).catch(() => null)));
        if (documentStore.mode === 'supabase') {
          const prot = await documentStore.getProtection(docs.map((d) => d.id)).catch(() => ({}) as Record<string, never>);
          setProtectedCount(results.some((r) => r?.status === 'protected') ? Object.values(prot).reduce((n, p) => n + p.regions.filter((g) => g.state === 'masked').length, 0) : null);
        }
      } catch {
        // 보호 실패는 문서 상태(failed)로 남는다
      }
      if (controller.signal.aborted) return;
      // ③ 문서 확인 + 계약 분석 (AI 1회)
      setPhase('analyze');
      setStep(0);
      timer = setInterval(() => setStep((v) => Math.min(v + 1, ANALYZE_MESSAGES.length - 1)), STAGE_MS);
      const run = () => aiProvider.analyze({ files: useRegistration.getState().files, documentIds: docs.map((d) => d.id), today }, controller.signal);
      try {
        let outcome: AnalysisOutcome;
        try {
          outcome = await run();
        } catch (e) {
          if (!(e instanceof AIConsentRequiredError)) throw e;
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
          outcome = await run();
        }
        if (controller.signal.aborted) return;
        clearInterval(timer);
        await handle(outcome);
      } catch (e) {
        if (!controller.signal.aborted) {
          setGate({ kind: 'failed', title: '계약서를 자동으로 정리하지 못했어요', message: e instanceof AIExtractionError ? e.message : '원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.', uploadFailed: false });
        }
      } finally {
        clearInterval(timer);
      }
    })();
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, today, attempt]);

  // 다른 파일·사진 고르기 / 다시 촬영 / 직접 입력 — 모두 보관본을 먼저 정리
  const chooseOther = () => {
    discardUploads();
    useRegistration.getState().reset();
    // 등록 방식 화면으로 되돌아간다 (새로 쌓지 않음)
    router.dismissTo('/register');
  };
  const retake = async () => {
    discardUploads();
    const p = await ensureCameraPermission();
    if (p !== 'granted') {
      const go = await confirm('카메라 권한이 필요해요', '계약서를 직접 촬영하려면 카메라 접근 권한을 허용해주세요.', p === 'blocked' ? '설정 열기' : '확인');
      if (go && p === 'blocked') openAppSettings();
      return;
    }
    useRegistration.getState().reset();
    router.replace('/register/capture');
  };
  const otherPhotos = async () => {
    const picked = await pickPhotos();
    if (!picked) return;
    discardUploads();
    useRegistration.getState().start('photo', picked, 'album');
    setGate(null);
    setNotice(null);
    setPhase('upload');
    setAttempt((a) => a + 1);
  };
  const manual = () => {
    discardUploads();
    router.replace('/register/manual');
  };

  if (gate?.kind === 'failed') {
    return (
      <Shell testID="analyzing-failed">
        <Center title={gate.title} body={gate.message} />
        <Actions>
          <Button
            label="다시 시도"
            onPress={() => {
              setGate(null);
              setStep(0);
              setPhase('upload');
              setAttempt((a) => a + 1);
            }}
          />
          {!gate.uploadFailed ? <Button label="직접 입력으로 계속하기" variant="secondary" onPress={manual} /> : <Button label="다른 파일 선택" variant="secondary" onPress={chooseOther} />}
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === 'stop') {
    if (gate.decision === 'stop_unreadable') {
      return (
        <Shell testID="gate-unreadable">
          <Center
            icon="eye-off-outline"
            title="계약 내용을 읽기 어려워요"
            body={gate.lowResolution?.length ? `${gate.lowResolution.join('·')}번째 사진의 해상도가 너무 낮아요. 글자가 선명하게 보이도록 다시 촬영해주세요.` : '글자가 선명하게 보이도록 다시 촬영해주세요.'}
          >
            <AppText variant="caption" color="textTertiary" align="center" style={{ marginTop: spacing.md }}>
              가능한 원인: {UNREADABLE_CAUSES.join(' · ')}
            </AppText>
          </Center>
          <Actions>
            <Button label="다시 촬영" onPress={retake} testID="gate-retake" />
            <Button label="다른 사진 선택" variant="secondary" onPress={otherPhotos} testID="gate-other-photos" />
          </Actions>
        </Shell>
      );
    }
    const insufficient = gate.decision === 'stop_insufficient';
    return (
      <Shell testID={insufficient ? 'gate-insufficient' : 'gate-non-contract'}>
        <Center
          icon="document-text-outline"
          title={insufficient ? '계약 정보를 충분히 찾지 못했어요' : '계약서로 확인하기 어려워요'}
          body={insufficient ? '계약 당사자·기간·금액 같은 정보를 찾기 어려웠어요. 직접 입력하거나 다른 파일을 선택해주세요.' : '계약 내용이나 당사자, 기간 등의 정보를 찾지 못했습니다.'}
        />
        <Actions>
          <Button label="다른 파일 선택" onPress={chooseOther} testID="gate-choose-other" />
          <Button label="직접 입력" variant="secondary" onPress={manual} testID="gate-manual" />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === 'confirm') {
    const supporting = gate.validation.role === 'supporting';
    const imagesSuspicious = gate.validation.suspiciousPages.some((p) => !p.pdf);
    return (
      <Shell testID="gate-confirm">
        <Center
          icon="help-circle-outline"
          title="계약서인지 확인이 필요해요"
          body={supporting ? '견적서·청구서 같은 계약 관련 자료로 보여요. 등록하려는 계약과 관련된 문서인가요?' : '이 문서가 등록하려는 계약과 관련된 문서인가요?'}
        />
        <Actions>
          <Button
            label="계약 관련 문서가 맞아요"
            onPress={() => (imagesSuspicious ? setGate({ kind: 'pages', validation: gate.validation, confirmRole: true }) : runFinalize({ confirmRole: true, includeFiles: [], excludeFiles: [] }))}
            testID="gate-confirm-yes"
          />
          <Button label="다른 파일 선택" variant="secondary" onPress={chooseOther} testID="gate-confirm-no" />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === 'pages') {
    return <PageChoice validation={gate.validation} files={files} onDone={(include, exclude) => runFinalize({ confirmRole: gate.confirmRole, includeFiles: include, excludeFiles: exclude })} />;
  }

  const title =
    phase === 'upload' ? '계약서를 안전하게 보관하고 있어요.' : phase === 'protect' ? '민감정보를 찾고 있어요.' : phase === 'done' ? '계약정보 정리가 완료됐어요.' : '문서를 확인하고 있어요.';
  const subtitle =
    phase === 'upload'
      ? '원본은 본인만 열람할 수 있는 비공개 저장소에 보관됩니다.'
      : phase === 'protect'
        ? '원본은 그대로 두고, 지원되는 PDF에서는 주민등록번호·계좌번호 등을 가린 보호본을 따로 만들어요.'
        : phase === 'done'
          ? '저장하기 전에 내용을 한 번 확인해주세요.'
          : '계약 관련 문서인지 확인하고, 꼭 관리해야 할 날짜와 금액, 주요 조건을 정리하고 있어요.';
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
        {notice ? (
          <AppText variant="caption" color="textSecondary" style={{ marginTop: spacing.md }} testID="analyzing-notice">
            {notice}
          </AppText>
        ) : null}
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.xxl }}>
          {files.length === 1 ? files[0].name : `${files[0]?.name} 외 ${files.length - 1}장`}
          {photoSource === 'camera' ? ' · 직접 촬영' : ''}
        </AppText>
      </View>
    </SafeAreaView>
  );
}

/** 의심 사진 쪽: 제외 / 그대로 포함 (기본: 계약과 무관·읽기 어려움·중복은 제외, 판단이 어려운 쪽은 포함) */
function PageChoice({ validation, files, onDone }: { validation: DocumentValidation; files: PickedFile[]; onDone: (include: number[], exclude: number[]) => void }) {
  const pages = validation.suspiciousPages.filter((p) => !p.pdf);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set(pages.filter((p) => p.role !== 'uncertain' || p.duplicateOf).map((p) => p.file)));
  const message = (p: (typeof pages)[number]) =>
    p.duplicateOf
      ? `${p.file}번째 사진이 ${p.duplicateOf.file}번째와 같은 페이지로 보여요.`
      : p.role === 'unreadable'
        ? `${p.file}번째 사진의 글자를 읽기 어려워요.`
        : p.role === 'uncertain'
          ? `${p.file}번째 사진이 계약과 관련된지 확인이 필요해요.`
          : `${p.file}번째 사진을 계약 관련 문서로 확인하기 어려워요.`;
  return (
    <Shell testID="gate-pages">
      <ScrollView contentContainerStyle={{ padding: spacing.gutter }}>
        <AppText variant="title2">확인이 필요한 사진이 있어요</AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          제외한 사진에서 읽은 날짜·금액은 계약 정보에 넣지 않고, 보관한 사진도 지워요.
        </AppText>
        {pages.map((p) => {
          const out = excluded.has(p.file);
          const set = (exclude: boolean) => {
            const next = new Set(excluded);
            if (exclude) next.add(p.file);
            else next.delete(p.file);
            setExcluded(next);
          };
          return (
            <View key={p.file} style={styles.pageRow} testID={`gate-page-${p.file}`}>
              {files[p.file - 1] ? <Image source={{ uri: files[p.file - 1].uri }} style={styles.pageThumb} contentFit="cover" /> : null}
              <View style={{ flex: 1, gap: spacing.sm }}>
                <AppText variant="body2Strong">{message(p)}</AppText>
                <View style={styles.choiceRow}>
                  <Choice label={`${p.file}페이지 제외`} selected={out} onPress={() => set(true)} testID={`gate-page-${p.file}-exclude`} />
                  <Choice label="그대로 포함" selected={!out} onPress={() => set(false)} testID={`gate-page-${p.file}-include`} />
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Actions>
        <Button
          label="선택한 대로 계속"
          onPress={() => onDone(pages.filter((p) => !excluded.has(p.file)).map((p) => p.file), pages.filter((p) => excluded.has(p.file)).map((p) => p.file))}
          testID="gate-pages-continue"
        />
      </Actions>
    </Shell>
  );
}

function Choice({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={hitSlop} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceOn]} testID={testID}>
      <AppText variant="captionStrong" color={selected ? 'textInverse' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Shell({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} testID={testID}>
      {children}
    </SafeAreaView>
  );
}

function Center({ icon, title, body, children }: { icon?: keyof typeof Ionicons.glyphMap; title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={styles.center}>
      {icon ? <Ionicons name={icon} size={40} color={colors.textTertiary} style={{ marginBottom: spacing.lg }} /> : null}
      <AppText variant="title2" align="center" testID="gate-title">
        {title}
      </AppText>
      <AppText variant="body2" color="textSecondary" align="center" style={{ marginTop: spacing.sm }}>
        {body}
      </AppText>
      {children}
    </View>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.gutter },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.gutter + 4 },
  fields: { marginTop: spacing.xl, gap: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, gap: spacing.sm },
  pageRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  pageThumb: { width: 64, height: 86, borderRadius: radius.sm, backgroundColor: colors.bg },
  choiceRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  choice: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
