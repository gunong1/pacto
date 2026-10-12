import { PROTECTION_REQUIRED_MESSAGE } from "@/domain/sensitive";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { aiProvider, documentStore } from "@/data";
import {
  AIConsentRequiredError,
  AIExtractionError,
  type AnalysisChoice,
  type AnalysisOutcome,
  type DocumentValidation,
  type ExtractInput,
  type PickedFile,
} from "@/data/ai/provider";
import {
  DocumentError,
  type ProtectionSummary,
  type UploadedDocument,
} from "@/data/documents";
import { SupabaseAIProvider } from "@/data/supabase/SupabaseAIProvider";
import type { DocumentProtection } from "@/domain/types";
import { viewOriginal } from "@/features/documents/openDocument";
import {
  EXCLUDE_PAGE_COPY,
  PAGE_STATUS_LABEL,
  isExcludedPhoto,
  isProblemPage,
  problemPageMessage,
  readyForAnalysis,
} from "@/features/documents/protectionCopy";
import { useToday } from "@/features/contracts/queries";
import {
  PDF_PASSWORD_COPY,
  PdfPasswordForm,
} from "@/features/documents/PdfPasswordForm";
import {
  ensureCameraPermission,
  openAppSettings,
} from "@/features/registration/camera";
import { checkPhotos, pickPhotos } from "@/features/registration/pickers";
import { useRegistration } from "@/features/registration/store";
import { confirm } from "@/lib/dialog";
import { mapWithConcurrency } from "@/lib/pool";
import { colors, hitSlop, radius, spacing } from "@/theme";

/** 사진 보호 동시 처리 수 — 로컬 Edge 측정: 3장 동시는 자원 한도 초과가 있었고 2장은 없었음 (실제 배포 측정 후 조정) */
const PROTECT_CONCURRENCY = 2;
const PROTECT_RETRY_DELAY_MS = 1500;

/**
 * 진행 단계 — 실제 처리 순서와 같다 (가짜 진행률을 만들지 않는다).
 * ① 계약서 보관 → ② 민감정보 보호(서버. PDF는 외부 전송 없음, 사진은 CLOVA OCR로 글자를 읽음) → ③ 문서 확인·계약 분석(AI 1회) → ④ 계약정보 정리
 * ③은 한 번의 요청에서 "계약 관련 문서인지"와 계약 내용을 함께 본다. 통과하지 못하면 확인 화면으로 가지 않는다.
 */
const PHASES = [
  { key: "upload", label: "계약서 보관" },
  { key: "protect", label: "민감정보 보호" },
  { key: "analyze", label: "문서 확인·계약 분석" },
  { key: "done", label: "계약정보 정리" },
] as const;
type Phase = (typeof PHASES)[number]["key"];
const ANALYZE_MESSAGES = [
  "계약 관련 문서인지 확인하고 있어요.",
  "어떤 계약인지 확인하고 있어요.",
  "중요한 날짜와 금액을 찾고 있어요.",
  "계약 기간과 종료 조건을 확인하고 있어요.",
  "주요 조건을 정리하고 있어요.",
] as const;
const STAGE_MS = 2600;

type Gate =
  | { kind: "failed"; title: string; message: string; uploadFailed: boolean }
  | {
      kind: "stop";
      decision: "stop_non_contract" | "stop_unreadable" | "stop_insufficient";
      lowResolution?: number[];
    }
  | { kind: "confirm"; validation: DocumentValidation }
  | { kind: "pages"; validation: DocumentValidation; confirmRole: boolean }
  /** 암호 PDF: 비밀번호 입력 (invalid = 직전 입력이 틀림 — 저장하지 않는 한 번의 결과) */
  | {
      kind: "password";
      fileLabel: string | null;
      invalid: boolean;
      busy: boolean;
    }
  /** 민감정보 보호를 마치지 못한 페이지가 있음 — 페이지별 결과 · 미리보기 · 이 페이지 빼고 분석 (사용자가 직접 고름) */
  | {
      kind: "protection";
      docs: GateDoc[];
      busy: boolean;
      error: string | null;
    }
  /** 비밀번호를 모름 / 지원하지 않는 보안 방식 / 보호 처리를 못 해 AI 분석을 자동으로 하지 않음 */
  | { kind: "locked"; reason: "unknown" | "unsupported" | "protection" };

/** 보호 결과를 보여줄 문서 하나 (올린 순서 그대로) */
interface GateDoc {
  doc: UploadedDocument;
  protection: DocumentProtection | undefined;
}

const UNREADABLE_CAUSES = [
  "흔들림",
  "너무 어두움",
  "문서 일부가 잘림",
  "해상도 부족",
];

/** "계약서를 확인하고 있습니다." — 보관 → 보호 → 문서 확인·분석. 계약 관련 문서로 확인된 경우에만 확인 화면으로. */
export default function AnalyzingScreen() {
  const today = useToday();
  const files = useRegistration((s) => s.files);
  const photoSource = useRegistration((s) => s.photoSource);
  const setExtraction = useRegistration((s) => s.setExtraction);
  const setUploaded = useRegistration((s) => s.setUploaded);
  const [phase, setPhase] = useState<Phase>("upload");
  const [protectedCount, setProtectedCount] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [gate, setGate] = useState<Gate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** 비밀번호 입력을 기다리는 중 — 제출(문자열) 또는 "모르겠어요"(null) */
  const passwordWait = useRef<((pw: string | null) => void) | null>(null);
  const askPassword = (fileLabel: string | null, invalid: boolean) =>
    new Promise<string | null>((resolve) => {
      passwordWait.current = resolve;
      setGate({ kind: "password", fileLabel, invalid, busy: false });
    });
  // 비밀번호는 이 화면을 벗어나면(분석 완료·취소·종료) 메모리에서도 지운다
  useEffect(
    () => () => {
      passwordWait.current?.(null);
      passwordWait.current = null;
      useRegistration.getState().clearPasswords();
    },
    [],
  );
  const jobId = useRef<string | undefined>(undefined);
  const done = useRef(false);

  const input = (): ExtractInput => {
    const s = useRegistration.getState();
    return {
      files: s.files,
      documentIds: s.uploaded.map((d) => d.id),
      today,
      passwords: s.passwords,
    };
  };

  /** 등록을 이어가지 않을 때: 보관한 원본·보호본을 지운다 (계약에 연결되지 않은 것만) */
  const discardUploads = () => {
    const { uploaded } = useRegistration.getState();
    if (uploaded.length)
      documentStore.discard(uploaded.map((d) => d.id)).catch(() => undefined);
    setUploaded([]);
  };

  /** 마무리에서 제외된 사진: 보관본을 지우고 목록에서 뺀다 */
  const dropExcluded = (excluded: number[] | undefined) => {
    if (!excluded?.length) return;
    const s = useRegistration.getState();
    const gone = excluded
      .map((f) => s.uploaded[f - 1])
      .filter((d): d is UploadedDocument => !!d);
    if (gone.length)
      documentStore.discard(gone.map((d) => d.id)).catch(() => undefined);
    const keep = (_: unknown, i: number) => !excluded.includes(i + 1);
    s.setUploaded(s.uploaded.filter(keep));
    s.setFiles(s.files.filter(keep));
  };

  /** 판정에 따라 다음 화면 */
  const handle = async (outcome: AnalysisOutcome) => {
    jobId.current = outcome.jobId ?? jobId.current;
    const v = outcome.validation;
    switch (v.decision) {
      case "proceed":
        if (!outcome.result)
          throw new AIExtractionError("계약서를 자동으로 정리하지 못했어요.");
        done.current = true;
        // 분석이 끝나면 비밀번호는 더 쓰지 않는다
        useRegistration.getState().clearPasswords();
        dropExcluded(outcome.excludedFiles);
        setPhase("done");
        setExtraction(outcome.result, v);
        await new Promise((r) => setTimeout(r, 700));
        router.replace("/register/review");
        return;
      case "confirm_role":
        setGate({ kind: "confirm", validation: v });
        return;
      case "choose_pages":
        setGate({ kind: "pages", validation: v, confirmRole: false });
        return;
      default:
        // 계약이 아니거나 읽기 어렵거나 정보가 부족 — 분석 중단, 보관본 정리, 계약·일정·알림을 만들지 않는다
        discardUploads();
        setGate({ kind: "stop", decision: v.decision });
    }
  };

  const runFinalize = async (choice: AnalysisChoice) => {
    setGate(null);
    setPhase("analyze");
    try {
      await handle(await aiProvider.finalize(jobId.current, choice, input()));
    } catch (e) {
      setGate({
        kind: "failed",
        title: "계약서를 자동으로 정리하지 못했어요",
        message:
          e instanceof AIExtractionError
            ? e.message
            : "원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.",
        uploadFailed: false,
      });
    }
  };

  /** 사용자가 페이지를 뺀 뒤 시작한 분석 — 화면을 벗어나면 멈춘다 */
  const gateAbort = useRef<AbortController | null>(null);
  useEffect(() => () => gateAbort.current?.abort(), []);

  /** 문서별 보호 결과를 다시 읽어 페이지별 결과 화면을 보여준다 (읽지 못하면 기존 안내) */
  const showProtectionGate = async (docs: UploadedDocument[]) => {
    const prot = await documentStore
      .getProtection(docs.map((d) => d.id))
      .catch(() => null);
    if (!prot) {
      setGate({ kind: "locked", reason: "protection" });
      return;
    }
    setGate({
      kind: "protection",
      docs: docs.map((doc) => ({ doc, protection: prot[doc.id] })),
      busy: false,
      error: null,
    });
  };

  /**
   * 사용자가 고른 페이지(사진은 그 사진)를 분석에서 뺀다 — 서버가 남은 페이지만으로 다시 보호·검증한다.
   * 남은 문서가 모두 보호 검증을 통과하면 그때 분석 (아니면 페이지별 결과를 다시 보여준다). 원본은 그대로
   */
  const excludePage = async (
    g: Extract<Gate, { kind: "protection" }>,
    target: GateDoc,
    page: number,
  ) => {
    const ok = await confirm(
      EXCLUDE_PAGE_COPY.confirmTitle,
      EXCLUDE_PAGE_COPY.confirmBody,
      EXCLUDE_PAGE_COPY.confirmLabel,
    );
    if (!ok) return;
    setGate({ ...g, busy: true, error: null });
    const isPdf = target.doc.mimeType === "application/pdf";
    const excludePages = isPdf
      ? [...new Set([...(target.protection?.excludedPages ?? []), page])].sort(
          (a, b) => a - b,
        )
      : [1];
    const password = useRegistration.getState().passwords[target.doc.id];
    const r = await documentStore
      .protect(target.doc.id, undefined, {
        excludePages,
        ...(password ? { password } : {}),
      })
      .catch(() => null);
    if (r?.detail === "no_pages_selected") {
      setGate({
        ...g,
        busy: false,
        error: "분석할 페이지가 남지 않아요. 문서를 다시 등록해주세요.",
      });
      return;
    }
    const docs = useRegistration.getState().uploaded;
    const prot = await documentStore
      .getProtection(docs.map((d) => d.id))
      .catch(() => null);
    if (!r || !prot) {
      setGate({
        ...g,
        busy: false,
        error: "페이지를 빼지 못했어요. 잠시 후 다시 시도해주세요.",
      });
      return;
    }
    if (docs.every((d) => readyForAnalysis(prot[d.id]))) {
      setGate(null);
      gateAbort.current?.abort();
      const c = new AbortController();
      gateAbort.current = c;
      await runAnalysis(docs, c.signal);
      return;
    }
    setGate({
      kind: "protection",
      docs: docs.map((doc) => ({ doc, protection: prot[doc.id] })),
      busy: false,
      error: null,
    });
  };

  /** ③ 문서 확인 + 계약 분석 — 보호 단계를 통과한 뒤 (또는 사용자가 문제 페이지를 뺀 뒤) */
  const runAnalysis = async (docs: UploadedDocument[], signal: AbortSignal) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    signal.addEventListener("abort", () => clearInterval(timer));
    // ③ 문서 확인 + 계약 분석 (AI 1회)
    setPhase("analyze");
    setStep(0);
    timer = setInterval(
      () => setStep((v) => Math.min(v + 1, ANALYZE_MESSAGES.length - 1)),
      STAGE_MS,
    );
    const run = () =>
      aiProvider.analyze(
        { ...input(), documentIds: docs.map((d) => d.id) },
        signal,
      );
    try {
      let outcome: AnalysisOutcome;
      try {
        outcome = await run();
      } catch (e) {
        if (!(e instanceof AIConsentRequiredError)) throw e;
        const ok = await confirm(
          "계약서 자동 정리 동의",
          "계약서 내용을 자동으로 정리하기 위해 원본을 외부 AI 서비스(OpenAI)로 전송해 처리합니다. 처리 결과는 저장 전에 직접 확인할 수 있어요. 동의하시겠어요?",
          "동의",
        );
        if (!ok) {
          if (!signal.aborted) router.replace("/register/manual");
          return;
        }
        if (aiProvider instanceof SupabaseAIProvider)
          await aiProvider.grantConsent();
        outcome = await run();
      }
      if (signal.aborted) return;
      clearInterval(timer);
      await handle(outcome);
    } catch (e) {
      if (!signal.aborted) {
        setGate({
          kind: "failed",
          title: "계약서를 자동으로 정리하지 못했어요",
          message:
            e instanceof AIExtractionError
              ? e.message
              : "원본은 보관되었어요. 계약정보는 직접 입력해서 저장할 수 있어요.",
          uploadFailed: false,
        });
      }
    } finally {
      clearInterval(timer);
    }
  };

  useEffect(() => {
    if (done.current) return;
    if (files.length === 0) {
      router.replace("/register");
      return;
    }
    const controller = new AbortController();
    (async () => {
      // ⓪ 업로드 전 사진 점검 (AI 비용 없음): 같은 사진은 한 번만, 너무 작은 사진은 다시 촬영 안내 (서버에 파일을 남기지 않음)
      if (useRegistration.getState().uploaded.length === 0) {
        const check = checkPhotos(files);
        if (check.lowResolution.length > 0) {
          setGate({
            kind: "stop",
            decision: "stop_unreadable",
            lowResolution: check.lowResolution.map((i) => i + 1),
          });
          return;
        }
        if (check.duplicates.length > 0) {
          setNotice(
            `같은 사진 ${check.duplicates.length}장은 한 번만 올렸어요.`,
          );
          useRegistration
            .getState()
            .setFiles(files.filter((_, i) => !check.duplicates.includes(i)));
          return; // files가 바뀌면 다시 실행된다
        }
      }
      // ① 원본 보관
      let docs = useRegistration.getState().uploaded;
      if (docs.length < files.length) {
        try {
          docs = [];
          for (let i = 0; i < files.length; i++)
            docs.push(await documentStore.upload(files[i], { sortOrder: i }));
          setUploaded(docs);
        } catch (e) {
          if (docs.length > 0)
            documentStore.discard(docs.map((d) => d.id)).catch(() => undefined);
          if (!controller.signal.aborted) {
            setGate({
              kind: "failed",
              title: "계약서를 보관하지 못했어요",
              message:
                e instanceof DocumentError
                  ? e.message
                  : "사진을 열 수 없거나 네트워크에 문제가 있어요. 다른 파일을 선택하거나 다시 시도해주세요.",
              uploadFailed: true,
            });
          }
          return;
        }
      }
      if (controller.signal.aborted) return;
      // ② 민감정보 보호 — 사진은 OCR을 쓰므로 동시에 PROTECT_CONCURRENCY장씩, 요청이 실패하면 한 번만 다시 (서버 자원 한도 등)
      if (documentStore.mode === "supabase") setPhase("protect");
      let results: (ProtectionSummary | null)[] = [];
      try {
        const protectOnce = (id: string) =>
          documentStore.protect(id).catch(() => null);
        results = await mapWithConcurrency(
          docs,
          PROTECT_CONCURRENCY,
          async (d) => {
            const r = await protectOnce(d.id);
            if (r && !(r.status === "failed" && r.detail === "request_failed"))
              return r;
            if (controller.signal.aborted) return r;
            await new Promise((res) => setTimeout(res, PROTECT_RETRY_DELAY_MS));
            return protectOnce(d.id);
          },
        );
        if (documentStore.mode === "supabase") {
          const prot = await documentStore
            .getProtection(docs.map((d) => d.id))
            .catch(() => ({}) as Record<string, never>);
          setProtectedCount(
            results.some((r) => r?.status === "protected")
              ? Object.values(prot).reduce(
                  (n, p) =>
                    n + p.regions.filter((g) => g.state === "masked").length,
                  0,
                )
              : null,
          );
        }
      } catch {
        // 보호 실패는 문서 상태(failed)로 남는다
      }
      if (controller.signal.aborted) return;
      // ②-1 암호 PDF: 비밀번호를 받아 서버 메모리에서만 열고 보호 처리 (비밀번호는 이 화면 메모리에만, 요청 body로만)
      for (let i = 0; i < docs.length; i++) {
        if (results[i]?.access !== "password_required") continue;
        const label =
          docs.length > 1
            ? `파일 ${i + 1} · ${files[i]?.name ?? ""}`
            : (files[i]?.name ?? null);
        let invalid = false;
        for (;;) {
          const pw = await askPassword(label, invalid);
          if (controller.signal.aborted) return;
          if (pw === null) {
            setGate({ kind: "locked", reason: "unknown" });
            return;
          }
          setGate({
            kind: "password",
            fileLabel: label,
            invalid: false,
            busy: true,
          });
          const r = await documentStore
            .protect(docs[i].id, undefined, { password: pw })
            .catch(() => null);
          if (controller.signal.aborted) return;
          // 비밀번호가 틀렸거나 받지 못함 = 보호 처리 없이 access만 온 응답 (status pending). 보호가 끝난 문서도 원본은 password_required로 남는다
          if (
            r?.status === "pending" &&
            (r.access === "invalid_password" ||
              r.access === "password_required")
          ) {
            invalid = true;
            continue;
          }
          if (r && r.status !== "failed")
            useRegistration.getState().setPassword(docs[i].id, pw);
          results[i] = r;
          break;
        }
        setGate(null);
      }
      // 지원하지 않는 보안 방식 / 암호 PDF인데 보호 처리를 못 함 → AI 분석을 자동으로 하지 않고 먼저 안내
      if (results.some((r) => r?.access === "unsupported_encryption")) {
        setGate({ kind: "locked", reason: "unsupported" });
        return;
      }
      if (
        results.some(
          (r) =>
            r?.access === "password_required" &&
            !(r.status === "protected" || r.status === "no_sensitive_data"),
        )
      ) {
        setGate({ kind: "locked", reason: "protection" });
        return;
      }
      // 모든 문서 공통 (fail-closed): 보호 완료(protected)·민감정보 없음(no_sensitive_data)이 아니면 AI 분석을 시작하지 않는다
      // (보호 실패·읽기 어려움·지원하지 않는 스캔/암호·결과 없음). 서버도 같은 기준으로 거절한다 — 원본을 대신 보내지 않음
      if (
        documentStore.mode === "supabase" &&
        !docs.every(
          (_, i) =>
            results[i]?.status === "protected" ||
            results[i]?.status === "no_sensitive_data",
        )
      ) {
        // 페이지별 결과를 보여주고, 문제 페이지를 사용자가 직접 뺄 수 있게 한다 (빼지 않으면 분석하지 않음)
        await showProtectionGate(docs);
        return;
      }
      await runAnalysis(docs, controller.signal);
    })();
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, today, attempt]);

  // 다른 파일·사진 고르기 / 다시 촬영 / 직접 입력 — 모두 보관본을 먼저 정리
  const chooseOther = () => {
    discardUploads();
    useRegistration.getState().reset();
    // 등록 방식 화면으로 되돌아간다 (새로 쌓지 않음)
    router.dismissTo("/register");
  };
  const retake = async () => {
    discardUploads();
    const p = await ensureCameraPermission();
    if (p !== "granted") {
      const go = await confirm(
        "카메라 권한이 필요해요",
        "계약서를 직접 촬영하려면 카메라 접근 권한을 허용해주세요.",
        p === "blocked" ? "설정 열기" : "확인",
      );
      if (go && p === "blocked") openAppSettings();
      return;
    }
    useRegistration.getState().reset();
    router.replace("/register/capture");
  };
  const otherPhotos = async () => {
    const picked = await pickPhotos();
    if (!picked) return;
    discardUploads();
    useRegistration.getState().start("photo", picked, "album");
    setGate(null);
    setNotice(null);
    setPhase("upload");
    setAttempt((a) => a + 1);
  };
  const manual = () => {
    discardUploads();
    router.replace("/register/manual");
  };

  if (gate?.kind === "failed") {
    return (
      <Shell testID="analyzing-failed">
        <Center title={gate.title} body={gate.message} />
        <Actions>
          <Button
            label="다시 시도"
            onPress={() => {
              setGate(null);
              setStep(0);
              setPhase("upload");
              setAttempt((a) => a + 1);
            }}
          />
          {!gate.uploadFailed ? (
            <Button
              label="직접 입력으로 계속하기"
              variant="secondary"
              onPress={manual}
            />
          ) : (
            <Button
              label="다른 파일 선택"
              variant="secondary"
              onPress={chooseOther}
            />
          )}
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === "password") {
    return (
      <Shell testID="gate-password">
        <PdfPasswordForm
          fileLabel={gate.fileLabel}
          invalid={gate.invalid}
          busy={gate.busy}
          onSubmit={(pw) => {
            const w = passwordWait.current;
            passwordWait.current = null;
            w?.(pw);
          }}
          onUnknown={() => {
            const w = passwordWait.current;
            passwordWait.current = null;
            w?.(null);
          }}
        />
      </Shell>
    );
  }

  if (gate?.kind === "protection") {
    return (
      <ProtectionPagesGate
        gate={gate}
        onPreview={(d, page) =>
          viewOriginal(
            {
              storagePath: d.doc.storagePath,
              localUri: d.doc.localUri,
              mimeType: d.doc.mimeType,
              protection: d.protection,
            },
            page,
          )
        }
        onExclude={(d, page) => excludePage(gate, d, page)}
        onRetry={() => {
          discardUploads();
          setGate(null);
          setStep(0);
          setPhase("upload");
          setAttempt((a) => a + 1);
        }}
        onReregister={chooseOther}
        onManual={manual}
      />
    );
  }

  if (gate?.kind === "locked" && gate.reason === "protection") {
    // 민감정보 보호를 마치지 못함 — 자동 분석 없음 (다시 시도 / 문서 다시 등록 / 직접 입력)
    return (
      <Shell testID="gate-locked-protection">
        <Center
          icon="lock-closed-outline"
          title="자동 분석을 진행하지 않았어요"
          body={PROTECTION_REQUIRED_MESSAGE}
        />
        <Actions>
          <Button
            label="다시 시도"
            onPress={() => {
              discardUploads();
              setGate(null);
              setStep(0);
              setPhase("upload");
              setAttempt((a) => a + 1);
            }}
            testID="gate-locked-retry"
          />
          <Button
            label="문서 다시 등록"
            variant="secondary"
            onPress={chooseOther}
            testID="gate-locked-other"
          />
          <Button
            label="직접 입력"
            variant="secondary"
            onPress={manual}
            testID="gate-locked-secondary"
          />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === "locked") {
    const body =
      gate.reason === "unknown"
        ? PDF_PASSWORD_COPY.unknown
        : PDF_PASSWORD_COPY.unsupported;
    return (
      <Shell testID={`gate-locked-${gate.reason}`}>
        <Center
          icon="lock-closed-outline"
          title={PDF_PASSWORD_COPY.title}
          body={body}
        />
        <Actions>
          <Button
            label="다른 파일 선택"
            onPress={chooseOther}
            testID="gate-locked-other"
          />
          <Button
            label="등록 취소"
            variant="secondary"
            onPress={() => {
              discardUploads();
              useRegistration.getState().reset();
              router.dismissAll();
            }}
            testID="gate-locked-secondary"
          />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === "stop") {
    if (gate.decision === "stop_unreadable") {
      return (
        <Shell testID="gate-unreadable">
          <Center
            icon="eye-off-outline"
            title="계약 내용을 읽기 어려워요"
            body={
              gate.lowResolution?.length
                ? `${gate.lowResolution.join("·")}번째 사진의 해상도가 너무 낮아요. 글자가 선명하게 보이도록 다시 촬영해주세요.`
                : "글자가 선명하게 보이도록 다시 촬영해주세요."
            }
          >
            <AppText
              variant="caption"
              color="textTertiary"
              align="center"
              style={{ marginTop: spacing.md }}
            >
              가능한 원인: {UNREADABLE_CAUSES.join(" · ")}
            </AppText>
          </Center>
          <Actions>
            <Button label="다시 촬영" onPress={retake} testID="gate-retake" />
            <Button
              label="다른 사진 선택"
              variant="secondary"
              onPress={otherPhotos}
              testID="gate-other-photos"
            />
          </Actions>
        </Shell>
      );
    }
    const insufficient = gate.decision === "stop_insufficient";
    return (
      <Shell testID={insufficient ? "gate-insufficient" : "gate-non-contract"}>
        <Center
          icon="document-text-outline"
          title={
            insufficient
              ? "계약 정보를 충분히 찾지 못했어요"
              : "계약서로 확인하기 어려워요"
          }
          body={
            insufficient
              ? "계약 당사자·기간·금액 같은 정보를 찾기 어려웠어요. 직접 입력하거나 다른 파일을 선택해주세요."
              : "계약 내용이나 당사자, 기간 등의 정보를 찾지 못했습니다."
          }
        />
        <Actions>
          <Button
            label="다른 파일 선택"
            onPress={chooseOther}
            testID="gate-choose-other"
          />
          <Button
            label="직접 입력"
            variant="secondary"
            onPress={manual}
            testID="gate-manual"
          />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === "confirm") {
    const supporting = gate.validation.role === "supporting";
    const imagesSuspicious = gate.validation.suspiciousPages.some(
      (p) => !p.pdf,
    );
    return (
      <Shell testID="gate-confirm">
        <Center
          icon="help-circle-outline"
          title="계약서인지 확인이 필요해요"
          body={
            supporting
              ? "견적서·청구서 같은 계약 관련 자료로 보여요. 등록하려는 계약과 관련된 문서인가요?"
              : "이 문서가 등록하려는 계약과 관련된 문서인가요?"
          }
        />
        <Actions>
          <Button
            label="계약 관련 문서가 맞아요"
            onPress={() =>
              imagesSuspicious
                ? setGate({
                    kind: "pages",
                    validation: gate.validation,
                    confirmRole: true,
                  })
                : runFinalize({
                    confirmRole: true,
                    includeFiles: [],
                    excludeFiles: [],
                  })
            }
            testID="gate-confirm-yes"
          />
          <Button
            label="다른 파일 선택"
            variant="secondary"
            onPress={chooseOther}
            testID="gate-confirm-no"
          />
        </Actions>
      </Shell>
    );
  }

  if (gate?.kind === "pages") {
    return (
      <PageChoice
        validation={gate.validation}
        files={files}
        onDone={(include, exclude) =>
          runFinalize({
            confirmRole: gate.confirmRole,
            includeFiles: include,
            excludeFiles: exclude,
          })
        }
      />
    );
  }

  const title =
    phase === "upload"
      ? "계약서를 안전하게 보관하고 있어요."
      : phase === "protect"
        ? "민감정보를 찾고 있어요."
        : phase === "done"
          ? "계약정보 정리가 완료됐어요."
          : "문서를 확인하고 있어요.";
  const subtitle =
    phase === "upload"
      ? "원본은 본인만 열람할 수 있는 비공개 저장소에 보관됩니다."
      : phase === "protect"
        ? "원본은 그대로 두고, 지원되는 PDF에서는 주민등록번호·계좌번호 등을 가린 보호본을 따로 만들어요."
        : phase === "done"
          ? "저장하기 전에 내용을 한 번 확인해주세요."
          : "계약 관련 문서인지 확인하고, 꼭 관리해야 할 날짜와 금액, 주요 조건을 정리하고 있어요.";
  const phases =
    documentStore.mode === "supabase"
      ? PHASES
      : PHASES.filter((p) => p.key !== "protect");
  const phaseIndex = phases.findIndex((p) => p.key === phase);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]} testID="analyzing">
      <View style={styles.body}>
        {phase === "done" ? (
          <Ionicons name="checkmark-circle" size={40} color={colors.primary} />
        ) : (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={{ alignSelf: "flex-start" }}
          />
        )}
        <AppText
          variant="title2"
          style={{ marginTop: spacing.xl }}
          testID="analyzing-title"
        >
          {title}
        </AppText>
        <AppText
          variant="body2"
          color="textSecondary"
          style={{ marginTop: spacing.sm }}
        >
          {subtitle}
        </AppText>
        <View style={styles.fields} testID="analyzing-stages">
          {phases.map((s, i) => {
            const state =
              i < phaseIndex || phase === "done"
                ? "done"
                : i === phaseIndex
                  ? "active"
                  : "todo";
            return (
              <View
                key={s.key}
                style={styles.field}
                testID={`analyzing-phase-${s.key}`}
              >
                {state === "active" ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={{ width: 20 }}
                  />
                ) : (
                  <Ionicons
                    name={
                      state === "done" ? "checkmark-circle" : "ellipse-outline"
                    }
                    size={20}
                    color={
                      state === "done" ? colors.primary : colors.textDisabled
                    }
                  />
                )}
                <AppText
                  variant="body"
                  color={state === "todo" ? "textTertiary" : "text"}
                >
                  {s.label}
                  {s.key === "protect" && state === "done" && protectedCount
                    ? ` · ${protectedCount}건 가림`
                    : ""}
                </AppText>
              </View>
            );
          })}
        </View>
        {phase === "analyze" ? (
          <AppText
            variant="body2Strong"
            color="primary"
            style={{ marginTop: spacing.lg }}
            testID="analyzing-stage-message"
          >
            {ANALYZE_MESSAGES[Math.min(step, ANALYZE_MESSAGES.length - 1)]}
          </AppText>
        ) : null}
        {notice ? (
          <AppText
            variant="caption"
            color="textSecondary"
            style={{ marginTop: spacing.md }}
            testID="analyzing-notice"
          >
            {notice}
          </AppText>
        ) : null}
        <AppText
          variant="caption"
          color="textTertiary"
          style={{ marginTop: spacing.xxl }}
        >
          {files.length === 1
            ? files[0].name
            : `${files[0]?.name} 외 ${files.length - 1}장`}
          {photoSource === "camera" ? " · 직접 촬영" : ""}
        </AppText>
      </View>
    </SafeAreaView>
  );
}

/** 의심 사진 쪽: 제외 / 그대로 포함 (기본: 계약과 무관·읽기 어려움·중복은 제외, 판단이 어려운 쪽은 포함) */
function PageChoice({
  validation,
  files,
  onDone,
}: {
  validation: DocumentValidation;
  files: PickedFile[];
  onDone: (include: number[], exclude: number[]) => void;
}) {
  const pages = validation.suspiciousPages.filter((p) => !p.pdf);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(
    () =>
      new Set(
        pages
          .filter((p) => p.role !== "uncertain" || p.duplicateOf)
          .map((p) => p.file),
      ),
  );
  const message = (p: (typeof pages)[number]) =>
    p.duplicateOf
      ? `${p.file}번째 사진이 ${p.duplicateOf.file}번째와 같은 페이지로 보여요.`
      : p.role === "unreadable"
        ? `${p.file}번째 사진의 글자를 읽기 어려워요.`
        : p.role === "uncertain"
          ? `${p.file}번째 사진이 계약과 관련된지 확인이 필요해요.`
          : `${p.file}번째 사진을 계약 관련 문서로 확인하기 어려워요.`;
  return (
    <Shell testID="gate-pages">
      <ScrollView contentContainerStyle={{ padding: spacing.gutter }}>
        <AppText variant="title2">확인이 필요한 사진이 있어요</AppText>
        <AppText
          variant="body2"
          color="textSecondary"
          style={{ marginTop: spacing.sm }}
        >
          제외한 사진에서 읽은 날짜·금액은 계약 정보에 넣지 않고, 보관한 사진도
          지워요.
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
            <View
              key={p.file}
              style={styles.pageRow}
              testID={`gate-page-${p.file}`}
            >
              {files[p.file - 1] ? (
                <Image
                  source={{ uri: files[p.file - 1].uri }}
                  style={styles.pageThumb}
                  contentFit="cover"
                />
              ) : null}
              <View style={{ flex: 1, gap: spacing.sm }}>
                <AppText variant="body2Strong">{message(p)}</AppText>
                <View style={styles.choiceRow}>
                  <Choice
                    label={`${p.file}페이지 제외`}
                    selected={out}
                    onPress={() => set(true)}
                    testID={`gate-page-${p.file}-exclude`}
                  />
                  <Choice
                    label="그대로 포함"
                    selected={!out}
                    onPress={() => set(false)}
                    testID={`gate-page-${p.file}-include`}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Actions>
        <Button
          label="선택한 대로 계속"
          onPress={() =>
            onDone(
              pages.filter((p) => !excluded.has(p.file)).map((p) => p.file),
              pages.filter((p) => excluded.has(p.file)).map((p) => p.file),
            )
          }
          testID="gate-pages-continue"
        />
      </Actions>
    </Shell>
  );
}

function Choice({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, selected && styles.choiceOn]}
      testID={testID}
    >
      <AppText
        variant="captionStrong"
        color={selected ? "textInverse" : "textSecondary"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/** 페이지 · 사진 하나 (보호 결과 줄) */
interface GateItem {
  key: string;
  docIndex: number;
  /** 원본 페이지 번호 (사진은 1) */
  page: number;
  label: string;
  status: string;
}

/** 문서별 보호 결과 → 줄 목록: PDF는 페이지마다, 사진은 장마다. 페이지 결과가 없는 PDF는 문서 한 줄 */
function gateItems(docs: GateDoc[]): GateItem[] {
  return docs.flatMap((d, i) => {
    const prefix = docs.length > 1 ? `${d.doc.fileName} ` : "";
    const p = d.protection;
    if (d.doc.mimeType !== "application/pdf")
      return [
        {
          key: `${i}-1`,
          docIndex: i,
          page: 1,
          label: docs.length > 1 ? `사진 ${i + 1}` : "사진",
          status: isExcludedPhoto(p) ? "excluded" : (p?.status ?? "failed"),
        },
      ];
    if (!p?.pages.length)
      return [
        {
          key: `${i}-0`,
          docIndex: i,
          page: 0,
          label: d.doc.fileName,
          status: p?.status ?? "failed",
        },
      ];
    return p.pages.map((x) => ({
      key: `${i}-${x.page}`,
      docIndex: i,
      page: x.page,
      label: `${prefix}${x.page}쪽`,
      status: x.status,
    }));
  });
}

/**
 * 민감정보 보호를 마치지 못한 페이지가 있을 때 — 페이지별 결과 · 문제 페이지 미리보기 · 이 페이지 빼고 분석 · 문서 다시 등록.
 * 빼지 않으면 분석하지 않는다 ("확인"만으로 넘어가는 방법 없음). 모든 페이지를 뺄 수는 없다.
 */
function ProtectionPagesGate({
  gate,
  onPreview,
  onExclude,
  onRetry,
  onReregister,
  onManual,
}: {
  gate: Extract<Gate, { kind: "protection" }>;
  onPreview: (d: GateDoc, page: number | null) => void;
  onExclude: (d: GateDoc, page: number) => void;
  onRetry: () => void;
  onReregister: () => void;
  onManual: () => void;
}) {
  const items = gateItems(gate.docs);
  const problems = items.filter((x) => isProblemPage(x.status));
  /** 남은(빼지 않은) 페이지 수 — 마지막 남은 페이지는 뺄 수 없다 */
  const remaining = items.filter((x) => x.status !== "excluded").length;
  const first = problems[0];
  return (
    <Shell testID="gate-locked-protection">
      <ScrollView
        contentContainerStyle={{
          padding: spacing.gutter,
          paddingTop: spacing.xl,
        }}
      >
        <Ionicons
          name="lock-closed-outline"
          size={36}
          color={colors.textTertiary}
        />
        <AppText
          variant="title2"
          style={{ marginTop: spacing.lg }}
          testID="gate-title"
        >
          자동 분석을 진행하지 않았어요
        </AppText>
        <AppText
          variant="body2"
          color="textSecondary"
          style={{ marginTop: spacing.sm }}
          testID="gate-protection-message"
        >
          {PROTECTION_REQUIRED_MESSAGE}
          {first ? `\n${problemPageMessage(first.status, first.label)}` : ""}
          {"\n"}민감정보 보호가 확인된 페이지만 AI 분석에 사용해요.
        </AppText>
        <View
          style={{ marginTop: spacing.lg, gap: spacing.sm }}
          testID="gate-protection-pages"
        >
          {items.map((x) => {
            const problem = isProblemPage(x.status);
            const d = gate.docs[x.docIndex];
            return (
              <View
                key={x.key}
                style={styles.pageRow}
                testID={`gate-page-${x.docIndex}-${x.page}`}
              >
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="body2Strong">{x.label}</AppText>
                  <AppText
                    variant="caption"
                    color={problem ? "check" : "textSecondary"}
                  >
                    {PAGE_STATUS_LABEL[
                      x.status as keyof typeof PAGE_STATUS_LABEL
                    ] ?? PAGE_STATUS_LABEL.failed}
                  </AppText>
                  {problem && x.page > 0 ? (
                    <View style={[styles.choiceRow, { marginTop: spacing.xs }]}>
                      <Button
                        label={`${x.label} 미리보기`}
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          onPreview(
                            d,
                            d.doc.mimeType === "application/pdf"
                              ? x.page
                              : null,
                          )
                        }
                        testID={`gate-preview-${x.docIndex}-${x.page}`}
                      />
                      {remaining > 1 ? (
                        <Button
                          label={
                            d.doc.mimeType === "application/pdf"
                              ? "이 페이지 제외하고 분석"
                              : "이 사진 제외하고 분석"
                          }
                          size="sm"
                          disabled={gate.busy}
                          onPress={() => onExclude(d, x.page)}
                          testID={`gate-exclude-${x.docIndex}-${x.page}`}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
        {gate.busy ? (
          <ActivityIndicator
            style={{ marginTop: spacing.lg }}
            color={colors.primary}
          />
        ) : null}
        {gate.error ? (
          <AppText
            variant="caption"
            color="check"
            style={{ marginTop: spacing.md }}
            testID="gate-protection-error"
          >
            {gate.error}
          </AppText>
        ) : null}
      </ScrollView>
      <Actions>
        <Button
          label="다시 시도"
          variant="secondary"
          onPress={onRetry}
          testID="gate-locked-retry"
        />
        <Button
          label="문서 다시 등록"
          variant="secondary"
          onPress={onReregister}
          testID="gate-locked-other"
        />
        <Button
          label="직접 입력"
          variant="secondary"
          onPress={onManual}
          testID="gate-locked-secondary"
        />
      </Actions>
    </Shell>
  );
}

function Shell({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]} testID={testID}>
      {children}
    </SafeAreaView>
  );
}

function Center({
  icon,
  title,
  body,
  children,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.center}>
      {icon ? (
        <Ionicons
          name={icon}
          size={40}
          color={colors.textTertiary}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
      <AppText variant="title2" align="center" testID="gate-title">
        {title}
      </AppText>
      <AppText
        variant="body2"
        color="textSecondary"
        align="center"
        style={{ marginTop: spacing.sm }}
      >
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.gutter,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.gutter + 4,
  },
  fields: { marginTop: spacing.xl, gap: spacing.md },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actions: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  pageRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
  },
  pageThumb: {
    width: 64,
    height: 86,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  choiceRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  choice: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
