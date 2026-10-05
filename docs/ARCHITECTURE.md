# PACTO(팩토) — V1 설계 문서

> **PACTO — 내 모든 계약이 모이는 곳.**
> "계약서를 넣어두세요. 중요한 순간은 PACTO가 기억합니다."
> UX 원칙: **"사용자가 계약서를 다시 펼쳐보지 않아도 되게 만든다."**

- 문서 상태: **전체 구조 승인 (2026-10-05) + 개정 1 반영**. 현재 구현 범위는 Step 1~4.
- 작성 기준일: 2026-10-05
- 범위: 아키텍처, 화면 목록, DB 스키마, 폴더 구조, V1 Task 분해, 기술/보안 리스크

## 개정 1 (2026-10-05) 요약
| # | 변경 | 반영 위치 |
|---|---|---|
| 1 | 포지셔닝: "AI 계약서 분석 앱" → **"개인용 계약 지갑"**. AI는 입력 비용을 줄이는 보조 엔진 | §0.5 |
| 2 | 하단 탭에서 AI 탭 제거 → **홈 / 계약 / (+) / 캘린더 / MY**. AI는 계약 상세 안에서만 | §3 |
| 3 | 홈 우선순위: 지출 → 지금 처리할 계약 → 곧 종료/갱신 → 상태 요약 → 최근 등록 → (보조) AI 확인 | §3.2 탭 > 홈 화면 구성 순서 |
| 4 | 계약을 자산/대상 단위로 묶는 `contract_groups` 확장 여지 | §4.8 |
| 5 | V1(P0) 테이블을 6개로 축소, 나머지는 P1/필요 시 | §4.0 |
| 6 | AI 체크 = 위험도 평가가 아니라 **일정 관리로 연결**. 금지/권장 표현 고정 | §2.6 |
| 7 | 홈 메인 금액 = **이번 달 실제 결제 예정액** (보조: 월평균, 연간 예상) | §1.2-A |
| 8 | 로그인 V1: 이메일 / Apple / Google. Kakao는 P1 이후 | §3.1 |
| 9 | Step 1~4는 mock AI provider만 사용. 실제 LLM은 UI/UX 검토 후 | §2.2, §10 |
| 10 | 브랜드: 금융/자산관리 앱 톤 (화이트 + 딥 네이비) | §6 |
| 11 | 구현 범위: Step 1~4만. Supabase/실제 AI/파일 업로드/Push 미연결 | §10 |
| 12 | 저장소: KOPICK과 분리된 신규 저장소 `pacto` 전제 | §0, §5 |

---

## 구현 현황
| Step | 상태 | 비고 |
|---|---|---|
| 1 프로젝트 셋업 | 완료 | 로컬 `pacto/` (Expo SDK 57, Router, TS strict, ESLint, Jest). Git 원격 미연결 |
| 2 domain 로직 | 완료 | 단위 테스트 26개 (D-87 / D-57 / D-268, 월환산 114,000원 등 검증) |
| 3 디자인 시스템 | 완료 | `src/theme`, `src/components/ui`, `src/components/pacto` |
| 4 Mock 화면 | 완료 | 필수 흐름 10단계 웹 E2E 통과 (`e2e/web-flow.js`). 실기기 UX 검토 대기 |

## 0.5 제품 포지셔닝 (최우선 기준)

PACTO는 **"내 모든 계약이 모이고, 계약이 끝날 때까지 관리되는 개인용 계약 지갑"**이다. "AI 계약서 분석 앱"이 아니다.

제품 우선순위 (기능 충돌 시 위가 이긴다):
1. 계약서 보관
2. 계약정보 자동정리
3. 계약 일정 관리
4. 월/연간 계약 지출 관리
5. 종료/갱신/해지 통보기한 관리
6. 계약 이력 축적
7. AI 주의조항 체크
8. AI 질문

설계/문구 결정 기준
- 첫인상은 "금융 지갑 같은 계약 관리 앱". **AI라는 단어를 탭·홈 상단·온보딩 첫 장에 전면 배치하지 않는다.** (등록 과정의 "자동으로 정리해드려요" 정도의 표현은 허용)
- 모든 화면은 "사용자가 지금 해야 할 행동"(해지 통보, 결제, 갱신 확인)을 먼저 보여준다.
- 이 철학에 맞지 않는 기능은 V1 우선순위를 낮춘다.

---

## 0. 현재 환경 점검 결과

| 항목 | 확인 결과 | 영향 |
|---|---|---|
| 저장소 | `gunong1/kopick` — **KOPICK(상품 비교 웹, Next.js 16 + Tailwind)** 프로젝트 | PACTO와 무관. **결정: PACTO는 신규 저장소 `pacto`로 운영.** 현재 세션은 `pacto` 저장소에 접근할 수 없어(존재하지 않음) 로컬 프로젝트로 먼저 생성하고 Git 원격 연결은 보류. 이 설계 문서만 임시로 kopick 브랜치에 보관 |
| 런타임 | Node v22.22.0, npm 10.9.4 | Expo 개발에 충분 |
| 최신 패키지(npm registry, 2026-10-05 조회) | `expo` 57.0.26 (SDK 57), `expo-router` 57.x, `react-native` 0.87.1, `@supabase/supabase-js` 2.117.2, `@tanstack/react-query` 5.104.1, `react-hook-form` 7.89.0, `zod` 4.6.5, `zustand` 5.0.15 | 실제 설치 시 `npx create-expo-app` / `npx expo install`로 SDK 호환 버전을 고정. 위 숫자는 조회값일 뿐, SDK 57과 각 라이브러리의 호환성은 설치 단계에서 재확인 필요 |
| 컨테이너 | 클라우드 리눅스 컨테이너. iOS 시뮬레이터/Android 에뮬레이터 없음 | 여기서는 타입체크·단위테스트·웹 프리뷰(`expo start --web`)까지 검증 가능. 실기기 검증은 사용자 기기(Expo Go 또는 dev build)에서 필요 |
| Supabase | 프로젝트 정보 없음 | Supabase 프로젝트 생성/URL/anon key 필요 (Step 5 전까지) |

---

## 1. 요구사항 분석 요약

### 1.1 제품의 본질
PACTO는 "AI 법률 분석기"가 아니라 **계약 생애주기 관리 도구**다. AI는 입력 비용을 줄이는 도구(문서 → 구조화 데이터)이고, 가치는 그 이후의 **일정·지출·종료/갱신 관리**에서 나온다.

→ 설계 원칙
1. **확정 데이터와 AI 추정 데이터를 분리 저장한다.** AI 결과는 `analysis_jobs.result`(초안)에만 존재하고, 사용자가 확인/수정 후 저장한 값만 `contracts` 등 본 테이블에 들어간다.
2. **AI 없이도 앱이 완전히 동작해야 한다.** 직접 입력 경로 = AI 경로의 마지막 단계(확인 폼)와 동일한 폼을 재사용.
3. **날짜·금액 계산은 순수 함수(domain 레이어)로 분리**하여 테스트한다. D-Day, 상태, 결제일 전개, 월 지출이 이 앱의 핵심 로직이며 버그가 곧 신뢰 손실이다.
4. **AI 표현 수위**: `일반 / 확인 필요 / 주의 필요` 3단계만 사용. 금지·권장 표현은 §2.6.
5. **AI는 보조 엔진**: AI 결과는 "관리 데이터(날짜·금액·일정)로 연결될 때" 가치가 있다. 위험도 평가 자체를 목적으로 하지 않는다.

### 1.2 요구사항에서 모호하거나 결정이 필요한 부분 (제안 포함)

| # | 이슈 | 제안 (기본값) |
|---|---|---|
| A | **"이번 달 지출"의 정의** | **확정**: 홈 메인 = **이번 달 실제 결제 예정액**("10월 계약 지출"). 연납 보험료는 실제 결제되는 달에만 포함. 보조 지표 = 월평균 계약비(연간 예상 ÷ 12), 연간 예상 계약지출(향후 12개월, 종료 계약 제외) |
| B | **계약 상태를 저장할지 계산할지** | 사용자가 정하는 것(진행/해지)만 저장(`lifecycle`), 나머지(종료 임박/갱신 예정/종료)는 날짜로 **계산**. 저장하면 매일 배치로 갱신해야 하고 불일치가 생김 |
| C | **"종료 임박" 기준일** | 기본 30일, 상수로 관리 (설정화는 P1) |
| D | **자동갱신 계약이 종료일을 지나면?** | 원래 `end_date`는 보존, `renewal_period_months`로 **현재 회차 종료일을 계산**해 표시하고 "자동갱신된 것으로 추정됩니다. 확인해주세요" 배너를 띄움. 임의로 DB 값을 바꾸지 않음 |
| E | **결제일이 29~31일인 달** | 해당 월 말일로 보정 (예: 31일 결제 → 2월 28/29일) |
| F | **정기결제 금액이 변동(통신비 등)** | `is_variable=true` 표시, 금액은 "예상"으로 표기 |
| G | **해지 통보기한 계산** | `종료일(현재 회차) − termination_notice_days`. 계약서에 "30일 전까지"가 '도달' 기준인지 '발송' 기준인지 등은 AI가 판단하지 않고 원문 근거를 보여줌 |
| H | **D-Day 기준 시간대** | 모든 날짜 계산은 `Asia/Seoul` 기준 로컬 날짜. 계약일 컬럼은 `date` 타입(시간대 없음) |

---

## 2. 전체 아키텍처

```
┌────────────────────────── Mobile App (Expo / React Native / TS) ──────────────────────────┐
│ Expo Router (app/)                                                                        │
│   └ screens ── features/* (hooks) ── repositories (interface)                              │
│                                   ├ MockRepository   (Step 4: mock data)                   │
│                                   └ SupabaseRepository (Step 5~)                            │
│ domain/ (순수 TS: D-Day, 상태, 결제일 전개, 지출 계산)  ← 단위 테스트 집중                     │
│ TanStack Query (서버 상태 캐시) · Zustand (계약 등록 위저드 초안 등 소량 클라이언트 상태)        │
│ React Hook Form + Zod (확인/수정 폼, 직접 입력 폼 공용)                                      │
└──────────────┬──────────────────────────────┬──────────────────────────────┬──────────────┘
               │ supabase-js (anon key + 사용자 JWT, RLS 적용)                 │
               ▼                              ▼                              ▼
       ┌──────────────┐             ┌──────────────────┐           ┌────────────────────────┐
       │ Supabase Auth│             │ PostgreSQL + RLS │           │ Storage (private bucket│
       │ (email/Apple │             │ tables, views,   │           │ `contract-files`)      │
       │  /Google)    │             │ RPC(save_contract)│           │ 경로: {uid}/{docId}/…  │
       └──────────────┘             └────────┬─────────┘           └───────────┬────────────┘
                                             │                                 │
                    ┌────────────────────────┴───── Edge Functions (Deno) ─────┴───────────┐
                    │ analyze-contract   : JWT 검증 → 소유권 확인 → 파일 다운로드 →           │
                    │                      AIProvider.extract() → Zod 검증 → job.result 저장  │
                    │ dispatch-notifications : (pg_cron 호출) 예정 알림 → Expo Push 발송        │
                    │ delete-account     : Storage 파일 삭제 → auth.admin.deleteUser (cascade) │
                    │ ask-contract (P2)  : 자리만 확보                                          │
                    │ _shared/ai/        : AIProvider 인터페이스 + gemini/openai/anthropic/mock │
                    └───────────────────────────────┬──────────────────────────────────────────┘
                                                    │ API Key는 Edge Function secret에만 존재
                                                    ▼
                                         외부 LLM (교체 가능)
```

### 2.1 기술 선택과 근거

| 영역 | 선택 | 이유 |
|---|---|---|
| 앱 | Expo SDK 57 + Expo Router + TypeScript(strict) | 요구사항 지정. 파일 기반 라우팅으로 탭/모달/스택 구성 단순 |
| 서버 상태 | TanStack Query | 캐시·무효화·로딩/에러 상태 표준화. 계약 저장 시 홈/목록/캘린더 동시 무효화 필요 |
| 클라이언트 상태 | Zustand (1~2개 store) | 등록 위저드(업로드→분석→확인) 단계 간 초안 공유 정도만 필요. Redux는 과함 |
| 폼 | React Hook Form + Zod | 확인 폼 필드 20여 개. Zod 스키마를 **클라이언트 폼 / Edge Function AI 출력 검증 / 타입** 3곳에서 공유 |
| 날짜 | `date-fns` (+ 필요 시 `date-fns-tz`) | 트리셰이킹, 불변. 시간대 이슈는 "로컬 날짜 문자열(YYYY-MM-DD)" 중심으로 다뤄 최소화 |
| 캘린더 UI | **자체 구현 월 그리드** (1순위) / `react-native-calendars` (대안) | 이벤트 유형별 점·금액 표시, 한국식 디자인 통제가 중요. 월 그리드는 구현 난이도 낮음 |
| 폰트 | Pretendard (SIL OFL) | 한글 가독성, 숫자 tabular figures 지원 |
| 테스트 | `jest-expo` + React Native Testing Library, DB는 pgTAP(Supabase CLI `supabase test db`) | domain 로직 / RLS 정책을 자동 검증 |
| 알림 | `expo-notifications` + Expo Push Service, 서버 스케줄은 `pg_cron` | P0는 데이터 구조 + 인앱 알림함, P1에서 Push |
| 오류 수집 | Sentry (P1, PII 스크러빙 필수) | — |

### 2.2 AI 서비스 추상화 레이어

```ts
// supabase/functions/_shared/ai/provider.ts
export interface AIProvider {
  readonly name: 'gemini' | 'openai' | 'anthropic' | 'mock';
  extractContract(input: ExtractInput): Promise<ExtractionResult>;   // P0
  reviewClauses(input: ReviewInput): Promise<ClauseReview[]>;        // P1 (extract와 1회 호출로 합칠 수 있음)
  answerQuestion?(input: AskInput): Promise<GroundedAnswer>;         // P2
}

export type ExtractInput = {
  files: { mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; bytes: Uint8Array }[];
  pageTexts?: string[];          // PDF 텍스트 레이어가 있으면 제공(근거 페이지 매칭에 사용)
  locale: 'ko-KR';
  today: string;                 // 'YYYY-MM-DD' (상대 날짜 해석용)
};

// 모든 필드는 값 + 신뢰도 + 근거를 가진다
export type Extracted<T> = {
  value: T | null;
  confidence: 'high' | 'medium' | 'low';
  evidence?: { page: number; quote: string }[];
};
```

- **Step 1~4: 앱 내부 `MockAIProvider`만 사용** (같은 인터페이스를 앱 쪽 `src/data/ai/`에 두고, Step 9에서 Edge Function 호출 구현체로 교체). 실제 LLM은 UI/UX 검토 완료 후, PDF/사진 추출 성능 비교 테스트를 거쳐 Gemini/OpenAI/Claude 중 선택.
- 선택: Edge Function 환경변수 `AI_PROVIDER=gemini|openai|anthropic|mock`, `AI_MODEL=...`.
- **출력은 반드시 Zod 스키마로 검증**. 실패 시 1회 재시도 후 `failed`로 기록, 사용자에게는 "직접 입력으로 계속하기" 제공.
- `prompt_version`을 job에 기록 → 프롬프트 변경 시 품질 비교 가능.
- `mock` 프로바이더: 고정 JSON 반환 → 키 없이 전체 플로우 개발/테스트 가능.
- 각 프로바이더의 PDF/이미지 직접 입력 지원 여부, 데이터 보존·학습 사용 정책은 **연결 시점에 공식 문서로 재확인 필요** (확실하지 않음: 정책은 수시로 바뀜).

### 2.3 계약 등록 데이터 흐름

```
[+] → 방식 선택(PDF / 사진 / 직접 입력)
  ├─ 직접 입력 ───────────────────────────────────────────────┐
  └─ PDF/사진                                                 │
      1. 클라이언트: 이미지 압축(expo-image-manipulator), 크기 제한 검사 │
      2. analysis_jobs INSERT (status=queued)                   │
      3. Storage 업로드: contract-files/{uid}/{jobId}/{fileId}.ext │
      4. contract_documents INSERT (job_id, storage_path)        │
      5. functions.invoke('analyze-contract', {jobId})          │
      6. "계약서를 확인하고 있습니다." — job 상태 폴링(2~3초) 또는 Realtime │
      7. job.status = succeeded → result(JSON 초안)              │
      8. 확인 화면: 초안으로 폼 채움 (신뢰도 low 필드 강조) ◄──────┘ (직접입력은 빈 폼)
      9. [계약 저장] → RPC save_contract(payload) — 단일 트랜잭션:
           contracts, contract_parties, contract_payments 생성
           contract_documents.contract_id 연결
           contract_field_sources(AI값 vs 확정값) 기록
           contract_ai_reviews 저장
           시스템 이벤트(시작/종료/해지통보/갱신) 재생성
           기본 notification_rules 생성
```

- Edge Function 실행 시간 제한이 있으므로(플랜별 상이, 정확한 수치는 확인 필요) **비동기 job + 상태 조회** 구조로 설계. 함수가 중간에 죽어도 job이 `processing`에 고착되지 않도록 `started_at` 기준 타임아웃 처리.
- 업로드만 하고 저장하지 않은 job/파일은 24시간 후 정리하는 cleanup 작업 필요.

### 2.4 일정(이벤트) 모델링 전략

- **정기 결제는 행을 무한히 만들지 않는다.** `contract_payments`(결제 규칙) → 조회 범위(예: 이번 달)에서 domain 함수 `expandPayments(range)`로 전개.
- **시작/종료/해지통보/자동갱신 일정은 저장하지 않고 계약 정보에서 계산**한다 (`domain/schedule.ts: contractSchedule`). *(Step 2 구현 중 변경: 저장 후 재생성 방식은 자동갱신 회차가 날짜에 따라 바뀌어 불일치가 생기므로 계산 방식 채택. 서버 알림 배치도 같은 domain 함수를 사용)*
- `contract_events`에는 **사용자 일정과 AI 제안으로 추가된 일정만** 저장 (`source='user'|'ai'`).
- 캘린더 = `expandPayments(month) ∪ contract_events(month)`.
- 같은 전개 로직을 서버(알림 배치)에서도 써야 하므로 domain 코드는 **RN/Node/Deno 의존성 없는 순수 TS**로 작성. (Edge Function 번들에서 `supabase/functions` 바깥 파일을 import 가능한지는 CLI 버전에 따라 확인 필요 — 불가하면 빌드 스크립트로 `_shared/domain`에 복사)

### 2.5 상태 계산 규칙 (domain/status.ts)

```
lifecycle = 'cancelled'                                  → 해지
lifecycle = 'ended' 또는 (end_date < today & !auto_renewal) → 종료
auto_renewal & (현재회차 종료일 − today) ≤ 30             → 갱신 예정
end_date & (end_date − today) ≤ 30                        → 종료 임박
그 외                                                     → 진행중
end_date 없음(무기한)                                     → 진행중 (D-Day 미표시)
```

### 2.6 AI 체크의 역할: "위험 평가"가 아니라 "일정 연결"

AI 체크는 보조 기능이다. 가장 중요한 역할은 계약서 속 조건을 **실제 관리 행동으로 바꾸는 것**이다.

```
원문: "계약 종료 30일 전까지 해지 의사를 통지하지 않으면 12개월 자동 연장"
 → 추출: auto_renewal=true, renewal_period_months=12, termination_notice_days=30
 → 계산: 해지 통보기한 = 현재 회차 종료일 − 30일 (domain/status.ts)
 → 제안: "해지 통보기한(12월 1일)을 캘린더에 등록할까요?"  [등록]
 → 저장 시: contract_events(termination_notice) 생성 + 알림 대상
```

표현 규칙 (프롬프트 지시 + 서버 후처리 금칙어 검사 + UI 고정 문구 3중 적용)

| 금지 | 권장 |
|---|---|
| 불법입니다 / 무효입니다 / 독소조항입니다 | 확인이 필요합니다 |
| 사용자에게 불리합니다 / 유리합니다 | 다음과 같이 기재되어 있습니다 |
| 반드시 손해를 봅니다 | 자동갱신 조건이 포함되어 있습니다 |
| (법적 효력·위법성에 대한 모든 단정) | 해지 통보기한을 확인해주세요 / 위약금 관련 조건이 있습니다 |

- severity 라벨: `일반 / 확인 필요 / 주의 필요` — "위험", "경고" 단어 미사용.
- 모든 AI 체크 카드 하단 고정 문구: "계약서 내용을 정리한 것이며 법률 자문이 아닙니다."
- Step 1~4의 mock 데이터 문구도 이 규칙을 따른다 (`src/domain/aiCopy.ts`의 금칙어 검사 유닛 테스트로 보장).

---

## 3. 화면 목록

우선순위: P0 = V1 필수, P1 = V1 후반/직후, P2 = 자리만.

### 3.0 하단 네비게이션 (개정 1)

**홈 / 계약 / (+) / 캘린더 / MY** — 중앙 (+)는 탭이 아니라 등록 모달을 여는 버튼.

- 선택 이유: 계약 지갑의 핵심 입력 행동(계약 넣기)을 항상 한 번에 접근 가능하게. "알림" 탭 대안은 V1에 Push가 없어 내용이 빈약하므로, 알림함은 홈 상단 우측 벨 아이콘으로 진입.
- **AI 탭 없음.** AI 기능은 계약 상세 안의 섹션으로만 제공:
  - "자동으로 정리된 계약정보" (확인/수정 이력)
  - "확인이 필요한 조항" (→ 일정 등록 제안)
  - "이 계약에 질문하기" (P2, V1은 진입점 + 준비중 안내)

### 3.1 인증/온보딩
| ID | 화면 | 경로 | P | 비고 |
|---|---|---|---|---|
| S01 | 스플래시/세션 게이트 | `app/index.tsx` | P0 | 세션 유무로 분기 |
| S02 | 온보딩 (3장 슬라이드) | `(auth)/onboarding` | P0 | 보관 → 자동정리 → 일정/알림 |
| S03 | 로그인/가입 선택 | `(auth)/welcome` | P0 | **이메일 / Apple / Google** (Kakao는 P1 이후). Step 1~4에서는 UI만, 실제 인증은 Step 6 |
| S04 | 이메일 로그인 | `(auth)/sign-in` | P0 | |
| S05 | 이메일 가입 | `(auth)/sign-up` | P0 | 약관·개인정보·**AI 처리(국외 이전 포함) 동의** |
| S06 | 비밀번호 재설정 | `(auth)/reset-password` | P0 | |
| S07 | 알림 권한 안내 | `(auth)/permissions` | P1 | 첫 계약 저장 후 요청하는 편이 수락률이 높음(추측입니다) |

### 3.2 탭
| ID | 화면 | 경로 | P | 주요 구성 |
|---|---|---|---|---|
| T1 | 홈 | `(tabs)/index` | P0 | 아래 "홈 화면 구성 순서" 참조 |
| T2 | 계약 목록 | `(tabs)/contracts` | P0 | 상태 세그먼트, 카테고리 필터, 정렬(D-Day/최근/금액), 검색(P1) |
| (+) | 계약 등록 | `register/` 모달 | P0 | 탭바 중앙 버튼 |
| T3 | 캘린더 | `(tabs)/calendar` | P0 | 월 그리드 + 날짜별 점(유형 색) · 하단 선택일 이벤트 리스트 · 월 합계 |
| T5 | MY | `(tabs)/my` | P0 | 프로필, 알림 설정, 보안(앱 잠금 P1), 약관, 데이터 내보내기(P2), 로그아웃, 회원 탈퇴 |

#### 홈 화면 구성 순서 (개정 1)

| 순서 | 섹션 | 예 | 비고 |
|---|---|---|---|
| 1 | **이번 달 실제 계약 지출** | "10월 계약 지출 ₩1,250,300" + 보조(월평균, 연간 예상) + 카테고리 분해 | 화면에서 가장 큰 숫자 |
| 2 | **지금 처리해야 할 계약** | "이번 주 확인할 계약 2건 — 헬스장 해지 통보기한 D-7 / 자동차보험 만료 D-31" | 해지 통보기한·결제·갱신 등 행동이 필요한 항목, 14일 이내(기본값) 또는 기한 임박순 |
| 3 | 곧 종료/갱신되는 계약 | "인터넷 D-83 / 정수기 D-152" | 종료일 기준 정렬 |
| 4 | 계약 상태 요약 | 진행중 12 · 종료 예정 2 · 갱신 예정 1 | 탭하면 목록 필터로 이동 |
| 5 | 최근 등록 계약 | 3건 | |
| 6 | (보조) 확인이 필요한 조항 | "확인이 필요한 조항 1건" 한 줄 링크 | 핵심 콘텐츠 아님. 없으면 숨김 |

### 3.3 계약 등록 (모달 스택)
| ID | 화면 | 경로 | P |
|---|---|---|---|
| R1 | 등록 방식 선택 (PDF/사진/직접 입력) | `register/index` (bottom sheet) | P0 |
| R2 | 사진 촬영/선택 + 페이지 순서 정리 | `register/photos` | P0 |
| R3 | 업로드·분석 진행 "계약서를 확인하고 있습니다." | `register/analyzing` | P0 |
| R4 | 분석 실패/부분 실패 | `register/analyzing` 내 상태 | P0 |
| R5 | **AI 추출 정보 확인/수정** "AI가 추출한 계약정보를 확인해주세요." | `register/review` | P0 |
| R6 | 직접 입력 (R5와 동일 폼, 빈 값) | `register/manual` | P0 구조 / P1 다듬기 |
| R7 | 저장 완료 → 상세로 이동 + "캘린더에 N개 일정 등록됨" | — | P0 |

### 3.4 계약 상세
| ID | 화면 | 경로 | P |
|---|---|---|---|
| D1 | 계약 상세 (헤더: 이름/상대방/상태/D-Day · 다음 할 일(해지통보/결제) · 금액·결제 · 기간·갱신 · 일정 · 원본 계약서 · 메모 · 자동 정리 정보 · 확인이 필요한 조항 · 이 계약에 질문하기(P2 진입점)) | `contract/[id]/index` | P0 |
| D2 | 계약 수정 | `contract/[id]/edit` | P0 |
| D3 | 원본 계약서 뷰어 (Signed URL, 페이지 이동) | `contract/[id]/document` | P0 |
| D4 | AI 체크 상세 + 원문 근거 + "캘린더에 등록" | `contract/[id]/review/[reviewId]` | P1 |
| D5 | 계약별 알림 설정 | `contract/[id]/notifications` | P0 |
| D6 | 일정 추가/수정 (사용자 일정) | `contract/[id]/event` | P0 |
| D7 | 계약 상태 변경(해지/종료 처리) | D1 액션시트 | P0 |
| D8 | 계약 AI 질문 | `contract/[id]/ask` | P2 (UI 자리만) |
| D9 | 변경 이력 | `contract/[id]/history` | P2 |

### 3.5 기타
| ID | 화면 | 경로 | P |
|---|---|---|---|
| E1 | 알림함 (인앱) | `notifications` | P0 |
| E2 | 전역 검색 | `search` | P1 |
| E3 | 회원 탈퇴 (재확인 + 삭제 범위 안내) | `settings/delete-account` | P0 (스토어 심사 필수) |
| E4 | 약관/개인정보처리방침 | `settings/legal` | P0 |

---

## 4. 데이터베이스 스키마

### 4.0 구현 범위 (개정 1)

아래 전체 스키마는 **장기 구조로 문서에 유지**하되, 실제 구현은 단계적으로 한다. 목표는 완벽한 모델보다 빠른 MVP 검증.

| 단계 | 테이블 | 비고 |
|---|---|---|
| **P0 (V1 최초 구현)** | `profiles`, `contracts`, `contract_documents`, `contract_payments`, `contract_events`, `analysis_jobs` | |
| P1 / 필요 시 | `contract_ai_reviews`, `contract_field_sources`, `contract_notes`, `notification_rules`, `push_tokens` | |
| 범위 밖(P2) | `contract_parties`(상세 당사자), `notifications`(발송 큐), `contract_shares`, `contract_groups` | |

P0만으로 동작시키기 위한 임시 대체:
- AI 체크 결과·필드 근거 → `analysis_jobs.result` JSON에서 읽음 (P1에서 `contract_ai_reviews`/`contract_field_sources`로 정규화)
- 메모 → `contracts.memo` 단일 필드
- 계약별 알림 on/off → `contracts.notifications_enabled` + `contract_events.notification_enabled` (오프셋 90/30/7일은 앱 상수)
- 상대방 → `contracts.counterparty` 텍스트

Step 1~4(현재 범위)에서는 DB를 만들지 않는다. 같은 형태의 **TypeScript 타입 + 인메모리 mock 저장소**로 구현하고, Step 5에서 위 P0 테이블로 옮긴다.

### 4.1 엔티티 관계

```
auth.users 1─1 profiles
auth.users 1─N contracts 1─N contract_parties
                         1─N contract_payments  (결제 규칙)
                         1─N contract_events    (단발 일정, 정기결제는 payment_id 참조 가능)
                         1─N contract_documents N─1 analysis_jobs
                         1─N contract_ai_reviews
                         1─N contract_field_sources (필드별 AI값/확정값/근거)
                         1─N contract_notes
                         1─N notification_rules
auth.users 1─N notifications, push_tokens
```

요구사항의 9개 엔티티 외 추가 테이블과 이유:
- `profiles` — `users`는 Supabase `auth.users`를 사용하고, 앱 프로필/동의 기록은 `public.profiles`에 둔다.
- `analysis_jobs` — AI 분석은 비동기이며, 저장 전 초안을 본 테이블과 분리하기 위해 필요.
- `contract_field_sources` — "원문 근거 연결"(P1) + "AI 값을 사용자가 수정했는지" 기록(추출 정확도 개선 지표).
- `notification_rules` — 계약별 알림 on/off와 오프셋(90/30/7일 등)을 유연하게.
- `push_tokens` — Push(P1) 대상 기기.

### 4.2 공통 규칙
- PK: `uuid default gen_random_uuid()`
- 모든 사용자 데이터 테이블에 `user_id uuid not null references auth.users(id) on delete cascade` (RLS 단순화 + 탈퇴 시 cascade 삭제)
- 금액: **`bigint` 원 단위 정수** (부동소수 금지), `currency char(3) default 'KRW'`
- 계약 날짜: `date`, 시각: `timestamptz`
- `updated_at`은 트리거로 갱신

### 4.3 DDL (초안)

```sql
-- ===== enums =====
create type contract_category as enum (
  'real_estate','vehicle','insurance','telecom','rental','finance',
  'employment','business','membership','subscription','other');
-- 부동산/자동차/보험/통신/렌탈/금융/근로/사업/회원권/구독/기타

create type contract_lifecycle as enum ('active','ended','cancelled');  -- 저장되는 상태만
create type payment_frequency  as enum ('one_time','monthly','bimonthly','quarterly','semiannual','yearly');
create type contract_event_type as enum ('payment','contract_start','contract_end','renewal','termination_notice','custom');
create type event_source   as enum ('system','ai','user');
create type review_severity as enum ('info','check','caution');          -- 일반/확인 필요/주의 필요
create type review_topic   as enum ('auto_renewal','termination','penalty','deposit','payment','price_change','obligation','other');
create type job_status     as enum ('queued','processing','succeeded','failed','expired');
create type party_role     as enum ('self','counterparty','guarantor','agent','other');
create type contract_source as enum ('upload','manual');
create type notification_rule_type as enum ('contract_end','termination_notice','renewal','payment');
create type notification_status as enum ('pending','sent','failed','cancelled');

-- ===== profiles =====
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_completed_at timestamptz,
  terms_agreed_at timestamptz,
  privacy_agreed_at timestamptz,
  ai_processing_agreed_at timestamptz,          -- AI 분석(외부 처리) 동의
  push_preview_enabled boolean not null default false, -- 잠금화면 알림에 계약명 노출 여부
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== analysis_jobs (AI 분석 초안) =====
create table analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status job_status not null default 'queued',
  provider text, model text, prompt_version text,
  result jsonb,                -- Zod 검증된 ExtractionResult (초안, 확정값 아님)
  error_code text,             -- 원문/개인정보 미포함 코드만
  contract_id uuid,            -- 저장 후 연결 (FK는 contracts 생성 후 alter)
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== contracts =====
create table contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  category contract_category not null default 'other',
  counterparty text,                                   -- 목록 표시용 대표 상대방 (상세는 contract_parties)
  lifecycle contract_lifecycle not null default 'active',
  lifecycle_changed_at timestamptz,
  contract_date date,
  start_date date,
  end_date date,
  check (end_date is null or start_date is null or end_date >= start_date),
  total_amount bigint check (total_amount >= 0),
  monthly_amount bigint check (monthly_amount >= 0),   -- 대표 정기결제 금액(캐시). 정본은 contract_payments
  payment_day smallint check (payment_day between 1 and 31),
  payment_frequency payment_frequency,
  auto_renewal boolean not null default false,
  renewal_period_months smallint check (renewal_period_months > 0),
  termination_notice_days smallint check (termination_notice_days >= 0),
  early_termination_terms text,                        -- 중도해지 관련 내용(요약)
  penalty_terms text,                                  -- 위약금 관련 내용(요약)
  deposit_amount bigint check (deposit_amount >= 0),
  currency char(3) not null default 'KRW',
  memo text check (char_length(memo) <= 2000),
  source contract_source not null default 'manual',
  analysis_job_id uuid references analysis_jobs(id) on delete set null,
  notifications_enabled boolean not null default true, -- 계약 단위 전체 on/off
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contracts (user_id, lifecycle);
create index on contracts (user_id, end_date);
alter table analysis_jobs add foreign key (contract_id) references contracts(id) on delete set null;

-- ===== contract_documents (원본 파일) =====
create table contract_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid references contracts(id) on delete cascade,  -- 저장 전 null
  analysis_job_id uuid references analysis_jobs(id) on delete set null,
  storage_path text not null unique,            -- '{uid}/{jobId}/{docId}.pdf' (public URL 절대 사용 안 함)
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  page_count smallint,
  sort_order smallint not null default 0,       -- 사진 여러 장 순서
  original_filename text,
  created_at timestamptz not null default now()
);
create index on contract_documents (contract_id);

-- ===== contract_parties =====
create table contract_parties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  role party_role not null,
  name text not null,
  contact text,                -- 고객센터 번호 등 (주민번호 등 고유식별정보 저장 금지)
  created_at timestamptz not null default now()
);

-- ===== contract_payments (정기/일회성 결제 규칙) =====
create table contract_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  label text not null default '납부금',        -- '월 렌탈료', '보험료', '할부금' ...
  amount bigint not null check (amount >= 0),
  currency char(3) not null default 'KRW',
  frequency payment_frequency not null,
  day_of_month smallint check (day_of_month between 1 and 31),   -- 말일 보정은 domain에서
  month_of_year smallint check (month_of_year between 1 and 12), -- yearly/semiannual 기준월
  starts_on date not null,
  ends_on date,                                 -- null이면 계약 종료일(현재 회차)까지
  is_variable boolean not null default false,   -- 금액 변동(통신비 등) → "예상" 표기
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contract_payments (user_id);

-- ===== contract_events =====
create table contract_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  event_type contract_event_type not null,
  title text not null,
  event_date date not null,
  amount bigint,
  is_recurring boolean not null default false,
  recurrence_rule text,                -- RRULE 부분집합 (예: 'FREQ=YEARLY'), 정기결제는 contract_payments 사용
  payment_id uuid references contract_payments(id) on delete cascade,
  source event_source not null default 'user',
  ai_review_id uuid,                   -- AI 체크에서 생성된 경우
  notification_enabled boolean not null default true,
  completed_at timestamptz,            -- 사용자가 '처리함' 체크 (예: 해지 통보 완료)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contract_events (user_id, event_date);

-- ===== contract_ai_reviews =====
create table contract_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  analysis_job_id uuid references analysis_jobs(id) on delete set null,
  severity review_severity not null,
  topic review_topic not null,
  title text not null,                 -- '자동갱신'
  description text not null,           -- 단정적 법률 판단 금지, "~로 기재되어 있습니다" 체
  evidence_quote text,                 -- 원문 근거 문구
  evidence_document_id uuid references contract_documents(id) on delete set null,
  evidence_page smallint,
  suggested_event jsonb,               -- {event_type, title, event_date} → "캘린더에 등록"
  linked_event_id uuid references contract_events(id) on delete set null,
  user_status text not null default 'new' check (user_status in ('new','acknowledged','dismissed')),
  created_at timestamptz not null default now()
);
alter table contract_events add foreign key (ai_review_id) references contract_ai_reviews(id) on delete set null;

-- ===== contract_field_sources (필드별 근거 + AI/확정값 비교) =====
create table contract_field_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  field_name text not null,            -- 'end_date', 'termination_notice_days' ...
  ai_value jsonb,
  confirmed_value jsonb,
  was_edited boolean generated always as (ai_value is distinct from confirmed_value) stored,
  confidence text check (confidence in ('high','medium','low')),
  evidence_document_id uuid references contract_documents(id) on delete set null,
  evidence_page smallint,
  evidence_quote text,
  unique (contract_id, field_name)
);

-- ===== contract_notes =====
create table contract_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  body text not null check (char_length(body) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== notification_rules (계약별 알림 설정) =====
create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  rule_type notification_rule_type not null,
  offset_days smallint not null check (offset_days >= 0),  -- 종료 90/30/7, 해지통보 7/1, 결제 1/0 ...
  enabled boolean not null default true,
  unique (contract_id, rule_type, offset_days)
);

-- ===== notifications (발송 큐 + 인앱 알림함) =====
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid references contracts(id) on delete cascade,
  event_id uuid references contract_events(id) on delete cascade,
  rule_id uuid references notification_rules(id) on delete set null,
  scheduled_for timestamptz not null,
  title text not null, body text not null,
  status notification_status not null default 'pending',
  dedupe_key text not null unique,     -- 'rule:{ruleId}:{targetDate}' 중복 발송 방지
  sent_at timestamptz, read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (status, scheduled_for);
create index on notifications (user_id, created_at desc);

-- ===== push_tokens (P1) =====
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  last_seen_at timestamptz not null default now()
);
```

### 4.4 RLS 정책

```sql
-- 모든 public 테이블
alter table <t> enable row level security;

-- 기본 패턴 (P2 가족 공유 확장을 위해 헬퍼 함수 경유)
create function can_access_contract(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contracts c where c.id = cid and c.user_id = (select auth.uid()));
  -- P2: or exists (select 1 from public.contract_shares s where s.contract_id = cid and s.member_id = auth.uid())
$$;

create policy "own rows" on contracts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- 하위 테이블도 user_id = auth.uid() 동일 패턴 + insert 시 can_access_contract(contract_id) 체크
--   → 다른 사람의 contract_id에 하위 행을 붙이는 공격 차단
-- notifications: 사용자는 select / update(read_at)만. insert는 service_role(서버)만.
-- analysis_jobs: 사용자는 insert(status=queued) / select만. result·status 갱신은 service_role만.
```

- `anon` 역할에는 어떤 테이블도 권한을 주지 않는다.
- **RLS 테스트를 pgTAP로 자동화**: 사용자 A의 JWT로 사용자 B의 행 select/insert/update/delete 시 0건/에러임을 검증.

### 4.5 Storage 정책

```sql
-- private 버킷 (public = false)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-files','contract-files', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/heic']);

create policy "own folder read"   on storage.objects for select to authenticated
  using (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- update 정책 없음(덮어쓰기 금지)
```
- 열람은 `createSignedUrl(path, 60~300초)`만 사용. `getPublicUrl` 사용 금지(린트 규칙/코드리뷰 체크).
- `on delete cascade`는 Storage 객체를 지우지 않음 → 계약 삭제/탈퇴 시 **Storage 파일 삭제를 별도로 수행**해야 함 (§7 참조).

### 4.6 RPC / 뷰

| 이름 | 역할 |
|---|---|
| `save_contract(payload jsonb) returns uuid` | 확인 화면 저장을 단일 트랜잭션으로 처리 (`security invoker` → RLS 그대로 적용) |
| `update_contract(id, payload)` | 수정 + 시스템 이벤트 재생성 |
| `regenerate_system_events(contract_id)` | `source='system'` 이벤트 삭제 후 시작/종료/해지통보/갱신 재생성 |
| 알림 생성 배치 (pg_cron, 매일 00:05 KST) | notification_rules × 이벤트/결제 → 향후 N일치 `notifications` upsert (dedupe_key) |
| `dispatch-notifications` (pg_cron → Edge Function, 매일 09:00 KST 등) | pending & scheduled_for ≤ now() → Expo Push |

상태(진행중/종료 임박 등)와 월 지출은 **클라이언트 domain 함수로 계산**(V1). 계약 수가 많아지면 SQL 뷰/함수로 이관.

### 4.7 Mock Data 매핑 (2026-10-05 기준 검증)

| 계약 | 카테고리 | 기간 | 결제 | 계산 결과 |
|---|---|---|---|---|
| 자동차보험 / 삼성화재 | insurance | 2026-01-01 ~ 2026-12-31 | yearly 1,368,000 (월환산 114,000) | 종료 D-87 ✔ (10/5→12/31 = 26+30+31) |
| SK매직 정수기 | rental | 2026-10-01 ~ 2029-09-30 | monthly 39,900, 25일 | 다음 결제 2026-10-25 |
| 인터넷 | telecom | 2024-07-01 ~ 2027-06-30 | monthly 38,500, auto_renewal | D-268 |
| 헬스장 | membership | 2026-01-01 ~ 2026-12-31 | monthly 55,000, 해지통보 30일 전 | 해지 통보기한 2026-12-01 (D-57), 종료 D-87 |

> 자동차보험 결제 방식(연납/월납)은 예시에 명시되지 않아 연납으로 가정했습니다(추측입니다).

### 4.8 계약 지갑 확장: 계약 묶음(`contract_groups`) — V1 미구현

장기적으로 여러 계약을 하나의 자산/대상 아래 묶는다.

```
Tesla Model Y  → 자동차보험, 자동차 할부, 보증 계약
우리 집         → 임대차 계약, 전세대출, 보증보험, 인터넷
사업            → OEM 계약, 물류 계약, 유통 계약
```

향후 마이그레이션안 (지금 테이블을 만들지 않음):
```sql
create type group_kind as enum ('vehicle','home','business','family','other');
create table contract_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind group_kind not null default 'other',
  name text not null,            -- 'Tesla Model Y', '우리 집'
  icon text, sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table contracts add column group_id uuid references contract_groups(id) on delete set null;
```
- 1계약 : 1그룹(nullable FK)으로 시작. 한 계약이 여러 그룹에 속해야 하면 그때 조인 테이블 `contract_group_members`로 전환.
- 지금 지켜야 할 것: 지출/일정 집계 함수를 "계약 배열 → 결과" 형태로 작성해 두면 그룹 단위 집계가 필터 하나로 가능. 화면 코드에 "전체 계약" 가정을 하드코딩하지 않는다.
- 사업자 모드(P2)의 `workspace_id`와는 별개 개념(그룹 = 사용자 내 분류, workspace = 소유 주체).

---

## 5. 폴더/파일 구조

```
pacto/
├─ app/                                # Expo Router (라우팅만, 로직 최소)
│  ├─ _layout.tsx                      # Providers: QueryClient, Theme, Auth, SafeArea
│  ├─ index.tsx                        # 세션 게이트 → (auth) or (tabs)
│  ├─ (auth)/  _layout.tsx onboarding.tsx welcome.tsx sign-in.tsx sign-up.tsx reset-password.tsx
│  ├─ (tabs)/  _layout.tsx index.tsx contracts.tsx add.tsx(+ 버튼, 등록 모달 오픈) calendar.tsx my.tsx   # AI 탭 없음
│  │          # ※ Expo SDK 57 템플릿 기준 라우트 폴더는 `src/app/` (아래 src/와 같은 레벨에 둠)
│  ├─ register/  _layout.tsx(modal) index.tsx photos.tsx analyzing.tsx review.tsx manual.tsx
│  ├─ contract/[id]/  index.tsx edit.tsx document.tsx notifications.tsx event.tsx ask.tsx(P2)
│  ├─ notifications.tsx
│  └─ settings/  delete-account.tsx legal.tsx
├─ src/
│  ├─ theme/        colors.ts typography.ts spacing.ts radius.ts index.ts
│  ├─ components/
│  │  ├─ ui/        Text Button Card ListRow Badge Chip Input DateField AmountField Select
│  │  │             BottomSheet EmptyState Skeleton Divider Toast
│  │  └─ pacto/     DDayBadge AmountText StatusBadge CategoryIcon SeverityBadge
│  │                ContractListItem UpcomingEventRow SpendingSummary MonthGrid
│  ├─ features/
│  │  ├─ auth/          useSession.ts authApi.ts
│  │  ├─ contracts/     queries.ts mutations.ts schema.ts(Zod) components/
│  │  ├─ registration/  store.ts(Zustand) upload.ts analysis.ts ReviewForm.tsx
│  │  ├─ calendar/      useMonthEvents.ts
│  │  ├─ spending/      useMonthlySpending.ts
│  │  ├─ notifications/ queries.ts push.ts(P1)
│  │  └─ ai/            (P2 ask 구조 — 계약 상세 내부에서만 사용)
│  ├─ domain/       # 순수 TS — RN/Supabase import 금지, 100% 단위 테스트 대상
│  │  ├─ dates.ts           todayInSeoul, clampDayOfMonth, diffDays
│  │  ├─ dday.ts            formatDDay ('D-7', 'D-Day', 'D+3')
│  │  ├─ status.ts          deriveContractStatus, currentTermEnd
│  │  ├─ schedule.ts        expandPayments(range), systemEvents(contract)
│  │  ├─ spending.ts        monthlySpending, annualForecast, monthlyEquivalent
│  │  ├─ money.ts           formatKRW
│  │  └─ __tests__/
│  ├─ data/
│  │  ├─ repository.ts      ContractRepository 인터페이스
│  │  ├─ ai/                AIProvider 인터페이스 + MockAIProvider (Step 1~4는 mock만)
│  │  ├─ mock/              mockContracts.ts MockContractRepository.ts
│  │  └─ supabase/          client.ts SupabaseContractRepository.ts
│  ├─ shared/schemas/       contract.ts extraction.ts  (Zod — Edge Function과 공유 대상)
│  ├─ lib/                  env.ts queryClient.ts secureStorage.ts logger.ts(PII 필터)
│  └─ types/database.ts     # `supabase gen types typescript` 산출물
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/   0001_schema.sql 0002_rls.sql 0003_storage.sql 0004_rpc.sql 0005_cron.sql
│  ├─ seed.sql      # 로컬 개발용 mock 4건
│  ├─ tests/        rls.test.sql (pgTAP)
│  └─ functions/
│     ├─ _shared/   ai/{provider.ts,types.ts,prompts/,providers/{gemini,openai,anthropic,mock}.ts}
│     │             auth.ts cors.ts log.ts(원문 미기록) schemas/(공유 Zod)
│     ├─ analyze-contract/index.ts
│     ├─ dispatch-notifications/index.ts
│     ├─ delete-account/index.ts
│     └─ ask-contract/index.ts   # P2 placeholder (501)
├─ assets/ fonts/(Pretendard) icons/
├─ app.config.ts  eas.json  tsconfig.json  eslint.config.js  jest.config.js
├─ .env.example   # EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY 만 (AI 키 절대 없음)
└─ docs/ ARCHITECTURE.md DESIGN_SYSTEM.md
```

규칙
- `app/`은 화면 조립만, 데이터는 `features/*` 훅으로.
- `domain/`은 외부 의존성 금지 → 서버(Deno)와 공유 가능.
- `EXPO_PUBLIC_*` 변수는 앱 번들에 그대로 포함되므로 **anon key 외 비밀값 금지**.

---

## 6. 디자인 시스템 방향 (Step 3에서 상세화)

**톤: 법률사무소가 아니라 금융/자산관리 앱.** 첫 화면 인상 = "내 계약을 보관하고 관리하는 금융 지갑".

- 화이트 중심. 배경 `#FFFFFF`, 섹션 구분 배경 `#F4F6F9` 정도의 아주 옅은 회색, 본문 `#191F28` 계열 진회색.
- Primary: **딥 네이비 1색** (`#14306B` 전후, 인터랙션은 같은 계열 블루 `#2457C5` 전후 — Step 3 토큰에서 확정, 이후 조정 가능). 보라색·그라데이션·네온 금지.
- 강조 대상은 **D-Day와 금액**. 그 외 요소는 무채색으로 물러나게.
- AI 관련 UI에 반짝이(✨)·보라 계열·로봇 아이콘 등 "AI 앱" 시그널 사용 금지. "자동 정리" 같은 기능 언어 사용.
- 시맨틱: 주의 필요 = 레드 계열, 확인 필요 = 앰버 계열, 일반 = 그레이. 색만으로 구분하지 않고 라벨 텍스트 병기(접근성).
- 타이포: Pretendard. 금액/D-Day는 크게·굵게·`tabular-nums`. 홈 지출 금액은 화면에서 가장 큰 텍스트.
- 카드는 "그룹이 필요한 곳"에만. 목록은 구분선 기반 ListRow 중심.
- 터치 영역 ≥ 44pt, 다이나믹 타입(시스템 글자 크기) 대응.

---

## 7. 보안 설계

| 요구 | 설계 |
|---|---|
| 사용자별 데이터 분리 | 모든 테이블 RLS + `user_id` + pgTAP 교차접근 테스트 |
| 안전한 파일 접근 | private 버킷, `{uid}/` 폴더 정책, Signed URL(짧은 만료), public URL 금지 |
| API Key 비노출 | AI 키는 Edge Function secrets에만. 앱에는 Supabase URL + anon key만. `service_role` 키는 앱/저장소에 절대 없음 |
| Edge Function 권한 | 요청 JWT로 사용자 확인 → job/document 소유권 검증 후에만 service_role로 파일 접근 |
| 로그 최소화 | 계약 원문·추출 결과·파일명 로그 금지. job_id, 단계, 소요시간, 에러 코드만. Sentry `beforeSend`로 스크러빙 |
| 회원 탈퇴 | `delete-account` 함수: ① Storage `{uid}/` 전체 삭제 ② `auth.admin.deleteUser` → FK cascade로 모든 행 삭제 ③ 기기 로컬 캐시·토큰 삭제. 실패 시 재시도 가능하게 idempotent |
| 기기 내 데이터 | 세션 토큰은 SecureStore 기반 암호화 저장(값 크기 제한 이슈는 §8). TanStack Query 영구 캐시(persist)는 V1에서 **사용 안 함** |
| 잠금화면 노출 | Push 본문 기본값은 "계약 일정이 다가왔습니다" 수준, 계약명 표시는 사용자가 켜야 함(`push_preview_enabled`) |
| 앱 잠금 | Face ID/지문 잠금 (P1, `expo-local-authentication`) |
| 고유식별정보 | 주민등록번호 등은 추출 대상에서 제외. 원본 파일에는 남아 있으므로 개인정보처리방침에 명시 |

---

## 8. 예상 기술 문제와 리스크

### 8.1 기술
| # | 문제 | 대응 |
|---|---|---|
| 1 | **Expo Go 한계**: Push 알림(특히 Android), 일부 네이티브 모듈(PDF 렌더러 등)은 Expo Go에서 동작하지 않음(SDK 53부터 Android Expo Go 원격 Push 제거로 알고 있음 — 최신 상태는 확인 필요) | 초반은 Expo Go, 알림/뷰어 단계부터 **EAS development build** 전환 |
| 2 | **PDF 원본 뷰어** | 1안: Signed URL을 WebView/`expo-web-browser`로 열기(간단, 페이지 점프 제약). 2안: `react-native-pdf`(dev build 필요, 페이지 이동 가능). 근거 페이지 이동이 P1이므로 V1은 1안 → P1에서 2안 검토 |
| 3 | **Edge Function 실행 시간/메모리 제한** — 대용량 PDF, 다수 이미지 | 파일 20MB·이미지 10장 제한, 클라이언트 압축, 비동기 job. 한계 초과 시 별도 워커(큐) 검토 |
| 4 | **스캔 PDF/사진 OCR 품질** | 멀티모달 LLM 직접 입력 우선. 신뢰도 low 필드 강조, 사용자 확인 필수 |
| 5 | **근거 페이지 정확도** | LLM이 페이지 번호를 틀릴 수 있음 → PDF 텍스트 레이어가 있으면 quote를 서버에서 재검색해 페이지 보정. 없으면 "근거 문구"만 표시 |
| 6 | **날짜 계산 엣지케이스** — 말일, 윤년, 시간대, 자동갱신 회차 | domain 순수 함수 + 경계값 테스트 |
| 7 | **정기결제 전개 성능** | 조회 범위(월/12개월)로만 전개, 계약 수백 건 수준은 클라이언트로 충분 |
| 8 | **SecureStore 값 크기 제한**(Supabase 세션 JSON이 클 수 있음) | Supabase 공식 가이드의 "AsyncStorage + SecureStore 키로 암호화" 패턴 적용 (구현 시 최신 문서 재확인) |
| 9 | **AI 출력 비결정성/스키마 위반** | Structured output(JSON schema) 사용 + Zod 검증 + 재시도 1회 + 실패 시 직접 입력 폴백 |
| 10 | **Edge Function에서 앱 코드(domain/Zod) 공유** | 순수 TS 유지. 번들러가 외부 경로 import를 못 하면 복사 스크립트 사용(확실하지 않음, Step 9에서 검증) |
| 11 | iOS 로컬 알림 예약 개수 제한(64개로 알려져 있음) | 서버 Push 방식을 기본으로 설계, 로컬 예약은 보조 |
| 12 | HEIC 이미지 | 업로드 전 JPEG 변환 |
| 13 | 저장 안 된 업로드(고아 파일) | 24h 지난 미연결 job/문서/파일 정리 cron |

### 8.2 보안/법적 (법률 자문 필요 — 아래는 검토 항목이지 결론이 아님)
| # | 리스크 | 대응 |
|---|---|---|
| 1 | 계약서 = 민감 개인정보 다수 포함 | 최소 수집, RLS, 암호화 저장, 접근 로그 |
| 2 | **외부 LLM 전송 = 개인정보 처리위탁 / 국외 이전** 해당 가능성 | 가입 시 별도 동의, 처리방침에 수탁자·국가·항목 명시, 학습 미사용(zero retention) 옵션 확인. **개인정보보호법 관점 법률 검토 필요** |
| 3 | AI 결과가 법률 자문으로 오인 | 고정 고지문 "법률 자문이 아닙니다", 단정 표현 금지 프롬프트 + 금칙어 후처리, 근거 문구 병기 |
| 4 | 앱스토어 심사 | 앱 내 계정 삭제 필수(Apple 5.1.1(v)), 제3자 소셜 로그인 제공 시 Sign in with Apple 요구 가능(4.8), 개인정보 라벨/Data Safety 작성 |
| 5 | 프롬프트 인젝션(계약서 안의 악성 문구) | AI 출력은 데이터로만 사용, 툴 실행 없음, 스키마 검증으로 영향 제한 |
| 6 | Supabase 리전 | 서울 리전(ap-northeast-2) 선택 권장 — 지연·데이터 위치 측면 |
| 7 | 서비스 키 유출 | service_role은 Edge Function secret에만, 저장소 시크릿 스캔 |

---

## 9. 결정 사항 (개정 1에서 확정)

| 질문 | 결정 |
|---|---|
| 저장소 | 신규 저장소 `pacto`. 접근 가능해질 때까지 로컬 프로젝트로 진행, Git 원격 연결 보류 |
| 홈 지출 숫자 | 이번 달 실제 결제 예정액 (보조: 월평균, 연간 예상) |
| 로그인 | 이메일 / Apple / Google. Kakao는 P1 이후 검토 |
| AI 프로바이더 | Step 1~4는 mock. UI/UX 검토 후 추출 성능 테스트로 선택 |
| Supabase | Step 5에서 결정 (서울 리전 권장) |
| 브랜드 | 화이트 + 딥 네이비, 금융 앱 톤 (§6) |

---

## 10. V1 개발 순서 (Task 단위)

각 Step 종료 조건(DoD)을 만족해야 다음 Step으로 이동. 검증 = 이 컨테이너에서 가능한 자동 검증 + 사용자 기기 확인 필요 항목 구분.

> **현재 승인된 구현 범위: Step 1~4.** Supabase, 실제 AI, 파일 업로드(Storage), Push Notification은 연결하지 않는다. Step 4 완료 후 실제 기기 UX 검토·승인을 받고 Step 5로 진행.

### Step 1. 프로젝트 셋업
- 1.1 로컬 `pacto/` 프로젝트 생성 (Expo SDK 57, TypeScript, Expo Router) — KOPICK 저장소와 분리
- 1.2 TS strict, ESLint, path alias(`@/` → `src/`)
- 1.3 jest-expo 설정
- 1.4 앱 이름/스킴 `pacto`, `.env.example`(아직 값 없음)
- **DoD**: `tsc --noEmit`, `lint`, `test` 통과 · 웹 프리뷰 기동

### Step 2. domain 로직
- 2.1 타입(Contract, ContractPayment, ContractEvent, ContractDocument, AnalysisJob, AiCheck)
- 2.2 `dates`(서울 기준 오늘, 말일 보정), `dday`, `status`(상태·현재 회차 종료일·해지 통보기한), `schedule`(결제 전개·시스템 일정 생성), `spending`(이번 달 실제 결제 예정액, 월평균, 연간 예상, 카테고리 분해), `actions`(홈 "지금 처리해야 할 계약"), `money`
- 2.3 AI 문구 금칙어 검사(`aiCopy`)
- 2.4 Zod 스키마(계약 확인/수정 폼)
- **DoD**: 경계값 단위 테스트 통과, §4.7 mock 계산값(D-87, D-57, D-268 등)과 일치

### Step 3. 디자인 시스템
- 3.1 토큰(color/typography/spacing/radius) — 금융 앱 톤
- 3.2 기본 컴포넌트(Text, Button, ListRow, Section, Badge, Chip, TextField, Segmented 등)
- 3.3 PACTO 컴포넌트(DDayBadge, Amount, StatusBadge, CategoryIcon, SeverityLabel, MonthGrid)
- **DoD**: 웹 프리뷰 스크린샷으로 확인 (폰트는 시스템 폰트로 시작, Pretendard는 기기 검토 시 결정)

### Step 4. Mock Data 기반 주요 화면
- 4.1 `ContractRepository` 인터페이스 + 인메모리 `MockContractRepository` + TanStack Query 훅 (앱 재시작 시 초기 mock으로 리셋)
- 4.2 `AIProvider` 인터페이스 + `MockAIProvider`(지연 후 고정 추출 결과 + 확인이 필요한 조항)
- 4.3 탭: 홈 / 계약 / (+) / 캘린더 / MY, 홈 우측 상단 알림함(예정 알림 목록)
- 4.4 계약 상세(다음 할 일, 금액·결제, 기간·갱신, 일정, 원본, 메모, 자동 정리 정보, 확인이 필요한 조항 → 일정 등록 제안, 질문하기 진입점)
- 4.5 등록: 방식 선택(PDF/사진/직접 입력) → 기기에서 파일 선택만(업로드 없음) → "계약서를 확인하고 있습니다." → "자동으로 정리한 계약정보를 확인해주세요." 확인/수정 폼 → [계약 저장]
- 4.6 시작 화면(로그인 UI: 이메일/Apple/Google — 모두 mock 진입)
- **DoD — 아래 흐름이 mock으로 동작**: ① 앱 실행 ② 홈 확인 ③ 계약 목록 ④ 계약 상세 ⑤ 계약 등록 ⑥ AI mock 결과 확인/수정 ⑦ 저장 ⑧ 홈/목록 반영 ⑨ 캘린더 반영 ⑩ 월 지출 반영. 자동 검증: domain 테스트 + 저장소 통합 테스트 + 웹 프리뷰 E2E 스크린샷. 이후 사용자 실기기(Expo Go) UX 검토.

### Step 5. Supabase 연결
- 5.1 Supabase CLI 로컬 환경, migrations 0001~0003(스키마/RLS/Storage), seed
- 5.2 pgTAP RLS 교차접근 테스트
- 5.3 `supabase gen types` → `types/database.ts`
- 5.4 supabase 클라이언트(세션 암호화 저장)
- **DoD**: `supabase db reset` + `supabase test db` 통과 (컨테이너에서 Docker 사용 가능 여부 확인 필요 — 불가 시 원격 개발 프로젝트로 검증)

### Step 6. 인증
- 6.1 온보딩(S02), 이메일 가입/로그인/재설정(S04~S06), 동의 기록(profiles)
- 6.2 세션 게이트, 로그아웃
- 6.3 소셜 로그인(Apple/Google, Kakao는 P1 이후) — dev build 필요 시 Step 11 전후로 이동 가능
- 6.4 회원 탈퇴 `delete-account` 함수 + E3 화면
- **DoD**: 가입→로그인→재실행 시 세션 유지→로그아웃→탈퇴 후 DB/Storage 데이터 0건 확인

### Step 7. 계약 CRUD
- 7.1 `save_contract` / `update_contract` / `regenerate_system_events` RPC
- 7.2 `SupabaseContractRepository`로 교체 (화면 코드 변경 최소화가 목표)
- 7.3 계약 삭제(Storage 파일 포함), 메모, 사용자 일정
- **DoD**: CRUD 통합 테스트, 다른 계정에서 접근 불가 확인

### Step 8. 파일 업로드
- 8.1 PDF 선택(expo-document-picker), 사진 촬영/선택(expo-image-picker), 압축/HEIC 변환, 다중 페이지 순서
- 8.2 Storage 업로드 + contract_documents 기록, 진행률/재시도
- 8.3 원본 보기(D3) Signed URL
- 8.4 고아 파일 정리 cron
- **DoD**: 실기기에서 PDF/사진 업로드·열람, 타 사용자 경로 접근 403 확인

### Step 9. AI 분석
- 9.1 `AIProvider` 인터페이스 + mock 프로바이더 + `analyze-contract` 함수(인증·소유권·상태 전이)
- 9.2 실제 프로바이더 1종 연결, 추출 프롬프트 v1, Zod 검증, 재시도
- 9.3 확인 화면(R5)에 신뢰도/근거 표시, `contract_field_sources` 저장
- 9.4 (P1) AI 체크 `contract_ai_reviews` + "캘린더에 등록"
- 9.5 샘플 계약서 5~10종(가상 데이터)으로 정확도 점검표
- **DoD**: 샘플셋 주요 필드 정확도 측정 결과 공유 · 로그에 원문 없음 확인

### Step 10. 캘린더/지출 (실데이터)
- 10.1 월 그리드 + 이벤트 전개(결제 규칙 + 이벤트), 날짜 탭 → 계약 이동
- 10.2 이번 달 지출/카테고리 분해/연간 예상(종료 계약 제외)
- **DoD**: domain 테스트 + 실데이터 수동 검증

### Step 11. 알림
- 11.1 notification_rules 기본값 생성(종료 90/30/7, 해지통보 7/1, 갱신, 결제 1일 전)
- 11.2 pg_cron 알림 생성 배치 + 인앱 알림함(E1)
- 11.3 (P1) EAS dev build, push_tokens 등록, `dispatch-notifications` + Expo Push
- **DoD**: 날짜를 조작한 테스트 데이터로 알림 생성/중복방지 검증, 실기기 Push 수신

### 이후 (P1 → P2)
검색/필터 고도화, 원문 근거 페이지 이동, 앱 잠금, Sentry → P2: 계약 질문(ask-contract), 가족 공유(`contract_shares` + `can_access_contract` 확장), 변경 이력(trigger 기반 audit 테이블), 이메일 수집, 사업자 모드(`workspace_id` 도입).

---

## 11. P2 확장 대비 포인트 (지금은 구현하지 않음)
- **가족 공유**: 모든 하위 테이블 접근을 `can_access_contract()` 경유 → 함수만 바꾸면 공유 지원
- **변경 이력**: `updated_at` 트리거 자리에 audit trigger 추가 가능하도록 테이블별 트리거 함수 분리
- **AI 질문**: `AIProvider.answerQuestion` 시그니처 + `contract/[id]/ask` 라우트 placeholder. 근거 응답 형식 `{answer, citations:[{document_id,page,quote}]}`
- **사업자 모드**: `contracts.user_id` → 추후 `owner_type/owner_id` 또는 `workspace_id` 마이그레이션 여지
