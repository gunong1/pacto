import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen, Section } from '@/components/ui/layout';
import type { ContractRecord } from '@/domain/types';
import { useContracts } from '@/features/contracts/queries';
import { viewDocument } from '@/features/documents/openDocument';
import { clearViewerLog, readViewerLog, VIEWER_DIAGNOSTICS, type ViewerLogEntry } from '@/features/viewer/diagnostics';
import { spacing } from '@/theme';

const MODE_LABEL: Record<string, string> = { route: '1 화면만', blank: '2 빈 WebView', init: '3 pdf.js 초기화', sample: '4 내장 PDF', real: '5 실제 문서' };

/** 마지막 실행(첫 단계 viewer_route부터)의 기록만 */
function lastRun(log: ViewerLogEntry[]): ViewerLogEntry[] {
  const i = log.map((e) => e.step).lastIndexOf('viewer_route');
  return i >= 0 ? log.slice(i) : log.slice(-20);
}

/** 5단계용: 보호본이 있는 PDF 계약서 한 건 */
function protectedPdfOf(records: ContractRecord[]) {
  for (const r of records) {
    const d = r.documents.find((x) => x.protection?.protectedViewPath && x.mimeType === 'application/pdf');
    if (d) return { doc: d, title: r.contract.title };
  }
  return null;
}

/**
 * 계약서 뷰어 진단 (preview APK·개발 빌드에서만) — 단계별로 열어 앱이 어디서 종료되는지 좁힌다.
 * 기록: 단계 이름·오류 코드·시각만 (계약서 주소·토큰·내용 없음). 앱이 종료돼도 다음 실행 때 마지막 단계가 보인다.
 */
export default function ViewerDiagnosticsScreen() {
  const { data } = useContracts();
  const [log, setLog] = useState(() => readViewerLog());
  const run = lastRun(log);
  // 5단계용: 보호본이 있는 PDF 계약서 한 건
  const target = protectedPdfOf(data ?? []);

  if (!VIEWER_DIAGNOSTICS) {
    return (
      <Screen>
        <AppText variant="body2">이 빌드에서는 진단 모드를 쓸 수 없어요.</AppText>
      </Screen>
    );
  }
  const open = (diag: string) => router.push({ pathname: '/viewer', params: { diag } });
  return (
    <Screen scroll>
      <Section title="지난 실행 기록" caption="앱이 종료됐다면 마지막 줄이 종료 직전 단계예요">
        {run.length === 0 ? (
          <AppText variant="body2" color="textSecondary">
            기록이 없어요.
          </AppText>
        ) : (
          run.map((e, i) => (
            <AppText key={`${e.t}-${i}`} variant="caption" color={i === run.length - 1 ? 'text' : 'textSecondary'} testID={`diag-log-${i}`}>
              {new Date(e.t).toLocaleTimeString('ko-KR')} · {MODE_LABEL[e.mode] ?? e.mode} · {e.step}
              {e.code ? ` (${e.code})` : ''}
            </AppText>
          ))
        )}
        <View style={styles.row}>
          <Button label="새로고침" size="sm" variant="secondary" onPress={() => setLog(readViewerLog())} />
          <Button
            label="기록 지우기"
            size="sm"
            variant="secondary"
            onPress={() => {
              clearViewerLog();
              setLog([]);
            }}
          />
        </View>
      </Section>
      <Section title="단계별로 열기" caption="위에서부터 하나씩 눌러, 어느 단계에서 앱이 종료되는지 확인해주세요">
        <View style={styles.buttons}>
          <Button label="1. 뷰어 화면만 열기" onPress={() => open('route')} testID="diag-route" />
          <Button label="2. 빈 WebView + 간단한 HTML" onPress={() => open('blank')} testID="diag-blank" />
          <Button label="3. pdf.js 초기화만 (문서 없음)" onPress={() => open('init')} testID="diag-init" />
          <Button label="4. 앱에 들어 있는 1쪽 테스트 PDF" onPress={() => open('sample')} testID="diag-sample" />
          <Button
            label={target ? `5. 실제 보호본 PDF (${target.title})` : '5. 실제 보호본 PDF (보호본이 있는 계약 없음)'}
            disabled={!target}
            onPress={() => target && viewDocument(target.doc)}
            testID="diag-real"
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  buttons: { gap: spacing.sm },
});
