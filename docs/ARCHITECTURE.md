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
| 7 | 홈 메인 금액 = **이번 달 실제 결제 예정액** (보조: 매달 나가는 정기 계약비 — 개정 7) | §1.2-A |
| 8 | 로그인 V1: 이메일 / Apple / Google. Kakao는 P1 이후 | §3.1 |
| 9 | Step 1~4는 mock AI provider만 사용. 실제 LLM은 UI/UX 검토 후 | §2.2, §10 |
| 10 | 브랜드: 금융/자산관리 앱 톤 (화이트 + 딥 네이비) | §6 |
| 11 | 구현 범위: Step 1~4만. Supabase/실제 AI/파일 업로드/Push 미연결 | §10 |
| 12 | 저장소: KOPICK과 분리된 신규 저장소 `pacto` 전제 | §0, §5 |

---

## 구현 현황
| Step | 상태 | 비고 |
|---|---|---|
| 1~4 | 완료·승인 | mock 기반 화면, domain 로직, 디자인 시스템 |
| 5 Supabase 기반 | 완료 | P0 6개 테이블, RLS, private `contract-files` 버킷, `save_contract` RPC, 타입 생성. 로컬 스택에서 검증 (클라우드 연결은 `docs/SUPABASE_SETUP.md`) |
| 6 인증 | 완료 | 이메일(가입·로그인·로그아웃·세션 유지·재설정·탈퇴), Apple/Google OAuth 구조 (공급자 키는 대시보드 설정 필요) |
| 7 계약 CRUD | 완료 | `SupabaseContractRepository` — 화면 코드는 저장소 교체만으로 동작 |
| 8 원본 보관 | 완료 | PDF/JPEG/PNG(HEIC→JPEG), Signed URL(120초) 열람, 취소 시 정리, 계약 삭제·탈퇴 시 파일 삭제 |
| 11 확장 레지스트리·계약 체크 | 완료 | 아래 "개정 4" — 분야 14·유형 10(근로·용역·매매 추가), 룩업 테이블, 수입/지출 방향, AI v4, PACTO 계약 체크 |
| 10 계약 유형 구조 | 완료 | 아래 "개정 3" — 유형 7종, 결제 여러 건, 주요 날짜, 유형별 속성(JSONB), AI 프롬프트 v3 |
| 9 실제 AI | 1차 연결 | OpenAI(Responses API, PDF·사진 직접 입력, strict JSON schema, store:false) — 서버 함수 `analyze-contract`. 동의 확인·본인 문서 검증·결과 검증·금지 표현 대체. 실제 정확도는 샘플 계약서로 측정 예정, Gemini/Claude는 같은 인터페이스로 추가 |

구현 중 결정 사항
- P0 동안 AI 체크는 `contracts.ai_checks`(jsonb)에 저장 → P1에서 `contract_ai_reviews`로 정규화
- `analysis_jobs`는 서버(Edge Function)만 기록 — 사용자 직접 기록 정책 제거 (migration 0004)
- 저장되지 않은 업로드: 등록 취소 시 앱에서 정리. 앱 강제 종료 등으로 남는 경우를 위한 서버 정리 작업(cron)은 출시 전 추가 필요
- Edge Function은 외부 패키지 없이 Supabase REST API만 사용 (공급망 의존 최소화)

## 개정 4 (2026-10-07) — 확장 가능한 계약 레지스트리 · PACTO 계약 체크

**원칙**: PACTO는 계약서가 좋은지 나쁜지 판정하는 앱이 아니라, 계약이 어떤 종류인지 이해하고 그 계약의 돈·날짜·의무·주의할 조건을 찾아 계약이 끝날 때까지 관리하는 앱이다.
흐름: 계약서 입력 → 분야 → 구조(유형) → 날짜·금액·의무 → 유형별 핵심 정보 → 확인이 필요한 조항 → 원문 근거 → 사용자 확인 → 캘린더·지출·알림 → 종료까지 관리.

**확장 구조**
- 단일 정의: `supabase/functions/_shared/contractRegistry.ts` (앱·서버 공용) — 분야, 유형, 유형별 속성(키·형식·선택지), 결제 의미(+기본 방향), 날짜 의미, 계약 체크 주제
- DB: enum 대신 text + 룩업 테이블(`contract_categories`, `contract_type_defs`, `contract_detail_fields`, `payment_kind_defs`, `contract_date_kind_defs`) + FK. 상세 속성 검사는 룩업 테이블 기반 트리거. 통합 테스트가 DB와 레지스트리 일치 여부를 검사
- 새 계약 종류 추가 = 레지스트리 항목 + 룩업 행 마이그레이션 (+ 선택: 앱 유형 프로필의 일정 이름). 앱이 모르는 코드는 '기타' 프로필로 동작하고 코드는 보존
- AI 스키마의 유형별 속성은 key/value 목록이라 유형이 늘어도 스키마 크기가 늘지 않는다

**분야(category) 14**: 근로·부동산·보험·자동차·금융·렌탈·통신·회원권·구독·교육·용역/프리랜서·사업/거래·매매·기타
**유형(contract_type) 10**: recurring·lease·installment(기존 auto_installment)·loan·insurance·employment·service·sale·one_time·other

**결제 방향** `contract_payments.direction = expense | income | neutral` — 급여·용역 대금 = 수입(지출 합계와 분리, 캘린더 월 합계 아래 "들어올 돈"), 보증금 = 중립. 매매·용역은 사용자 역할(매수인/매도인, 수행자/발주자)에 따라 방향이 다름

**AI v4** (`extract-v4`): 분야·유형 각각 신뢰도·대안·이유 → 날짜 의미(입사·납기·검수·인도·소유권 이전 추가) → 금액 의미·주기·방향 → 유형별 속성 목록 → 종료·갱신 조건 → PACTO 계약 체크(주제·등급·신뢰도·원문 문장·쪽·파일 번호·관련 날짜). 금지 표현(불법·무효·독소조항·불공정·위험합니다 등)은 서버에서 중립 문장으로 대체

**PACTO 계약 체크** (내부: clause review) — 일반 / 확인 필요 / 주의 필요
- 공통 주제: 자동갱신·중도해지/위약금·환불 제한·일방적 변경·손해배상·해지 권한·보증금 반환·연체·관할/분쟁·통보기한, 유형별 주제(근로: 급여·근로시간·수습·비밀유지·경업금지 / 임대차: 원상복구·수선·관리비 / 대출: 변동금리·기한이익 상실·만기연장·중도상환 / 할부: 담보·소유권 / 보험: 보험료 변경·면책·대기기간·해지환급 / 월 납입형: 최소 이용기간·장비 반환·요금 변경 / 용역: 대금 지급·검수·수정 요구·저작권 / 매매: 인도·이전)
- 원문 근거(문서 id·쪽·문장) 저장, [원문 보기]는 Signed URL + PDF `#page=N`. 근거 없는 항목은 신뢰도 low로 낮추고 "원문과 비교" 안내
- 관리 연결: 자동갱신·통보기한 → 해지 통보기한 날짜 계산 → 캘린더·알림 / 명시된 날짜 → [캘린더에 추가] (확인 화면에서 선택하면 저장 시 일정 생성, 상세에서도 추가)

**분석 중 화면**: 고정 필드 체크리스트 제거 → 공통 6단계(계약 유형 → 날짜 → 금액·납입 구조 → 기간·일정 → 종료·갱신·만기 → 중요한 조건)와 단계별 문구. 서버 분석은 한 번의 요청이라 단계는 시간 기준으로 넘기고 마지막 단계에서 응답을 기다린다

## 개정 3 (2026-10-06) — 계약 유형별 구조

**원칙**: PACTO는 계약서를 단순히 읽는 앱이 아니라, 계약 유형을 이해하고 그 계약에 맞는 돈과 날짜를 관리하는 앱이다.
AI 순서: 계약서 입력 → 계약 유형 분류(신뢰도·대안) → 날짜·금액의 의미 분류 → 유형별 필드 추출 → 일정·지출 생성 → 사용자 확인 → 저장.

**분야와 유형 분리** (합치지 않는다)
- `category` = 사용자가 이해하는 분야 (부동산·통신·보험·자동차·금융·렌탈·회원권·구독 …) — 아이콘·필터
- `contract_type` = 돈과 날짜가 움직이는 방식 — `recurring`(월 납입형) · `lease`(임대차) · `auto_installment`(자동차 할부) · `loan`(대출) · `insurance`(보험) · `one_time`(일회성) · `other`
- 예: 자동차 분야 = 할부(auto_installment) / 리스·장기렌트(recurring) / 자동차보험(insurance)
- 유형은 로직·화면 구성을 고르는 기준일 뿐, 계약서 내용보다 우선하지 않는다. 일정·지출은 그 계약에 실제로 저장된 결제 목록과 날짜에서 만든다.

**데이터** (`supabase/migrations/20261006000001_contract_types.sql`)
- `contracts.contract_type` + `contracts.contract_details`(JSONB) — 유형별 속성. 허용 키·값 형식을 DB(`valid_contract_details` 검사 제약)와 앱(`DETAIL_SCHEMAS`, Zod)에서 같은 목록으로 검증. AI 결과도 같은 스키마로 정리. 자주 검색·통계하는 키는 같은 이름(snake_case)으로 정식 컬럼 승격 가능.
- `contract_payments.kind`(결제 의미) + `installment_count`(총 회차) — 한 계약에 결제 여러 건 (월 렌탈료 + 설치비, 계약금 + 잔금, 월세 + 관리비 …)
- `contract_dates` — 유형별 주요 날짜 (설치·개통·입주·잔금·갱신·기타). 시작·종료는 `contracts.start_date/end_date`, 체결일은 `contract_date`(선택값, 기록용)
- `save_contract` v2: 계약 + 결제 목록 + 날짜 목록 + 원본 연결을 한 트랜잭션으로 (목록은 통째로 교체)
- 기존 데이터: 분야에서 유형 결정(부동산→임대차, 보험→보험, 금융→대출, 렌탈·통신·회원권·구독→월 납입형, 그 외 정기 결제 있으면 월 납입형)

**일정·지출 규칙** (`src/domain/contractTypes.ts`, `schedule.ts`, `spending.ts`)
- 계약 체결일은 캘린더·알림에 쓰지 않는다 (상세 화면 "계약 조건 · 기록"에만)
- 시작·종료 일정 이름은 유형별 (이용 시작/임대차 시작/대출 실행/보험 시작 … · 이용 종료/계약 만기/할부 만기/대출 만기/보험 만기/계약 완료). 할부·일회성은 시작일 일정 없음
- 회차가 있는 결제는 "할부금 3/36회"로 표시하고 마지막 회차 이후 생성하지 않음
- 임대차는 만기 60일 전 "갱신 여부 확인" 시점, 통보기한 이름은 "종료 통보기한"
- 지출 = 실제 결제 발생액. 보증금(`kind=deposit`, 전세금·보증금의 계약금/잔금)은 돌려받는 돈이라 지출 합계에서 제외하고 캘린더에는 표시 (캘린더 월 합계 아래 별도 안내). 연납은 결제 월에 전액. 정기 결제의 월 환산(매달 나가는 정기 계약비)은 보조 지표 — 일시불 제외
- 날짜가 없는 일회성 비용(설치비 등)은 계약 시작일로 계산하고 확인 화면에서 "확인 필요"로 표시
- 수정 폼에서 결제 시작일이 계약 시작일과 같으면 비워 두어 "시작일을 따라감"으로 처리 → 시작일을 고치면 결제도 함께 이동
- 할부·대출의 "다음 행동"은 만기 90일 전부터, 그 전에는 "다음 결제"

**AI 프롬프트 v3** (`supabase/functions/_shared/extraction.ts`, 앱 변환 `src/features/registration/extraction.ts`)
- 모델 출력: 유형(신뢰도·대안·이유) / 공통 필드 / 날짜 목록(의미: 체결·기간 시작·이용 개시·설치·개통·입주·잔금·실행·첫 납입·보험 시작·만기·갱신·완료·통보기한·기타) / 결제 목록(의미·주기·결제일·회차) / 유형별 속성 / 확인할 조항
- 계약서에 없는 체결일·결제일은 만들지 않는다 (null)
- 앱 변환: 유형별 날짜 의미 우선순위로 시작·종료를 고르고, 나머지 날짜는 주요 날짜로 보존. 유형 신뢰도가 높지 않으면 "확인 필요" + 대안 유형 표시, 사용자가 유형을 바꾸면 유형별 속성만 다시 고른다
- 신뢰도는 높음/보통/낮음으로 표시 (모델이 스스로 매긴 % 수치는 보정되지 않은 값이라 쓰지 않음)
- Structured Outputs 스키마는 속성 90개·중첩 3단계로 보수적 제한(100개/5단계) 안에 둔다 (테스트로 검사)

**화면**
- 확인/직접 입력/수정 공용 폼: 계약 유형 → 기본 정보 → 기간(유형별 날짜 이름, 체결일은 선택) → 유형별 정보 → 결제 목록(추가·수정·삭제) → 주요 날짜 목록 → 갱신·해지(해당 유형만) → 기타 → 저장 시 관리되는 결제·일정 미리보기
- 계약 상세 "핵심 정보" (`src/domain/coreInfo.ts`): 전세 = 보증금·계약금·잔금·입주일·기간 / 대출 = 원금·금리·상환방식·월 상환액·남은 회차·만기 / 할부 = 할부원금·월 납입액·남은 회차·만기 / 렌탈 = 월 렌탈료·결제일·자동갱신·해지 통보기한 …

**테스트**: 7개 기준 계약(렌탈·전세·월세·자동차 할부·대출·연납 보험·계약금/중도금/잔금 일회성) — 단위(`contract-types.test.ts`), AI 변환(`extraction.test.ts`), 실제 DB+화면 E2E(`e2e/rental-scenario.js`, `e2e/contract-types.js`)

## 개정 2 (2026-10-05) — "계약 지갑" 정체성 강화
| # | 변경 | 반영 위치 |
|---|---|---|
| P1 | 홈 최상단에 **"지금 확인이 필요한 계약"** 강조 영역 (차분한 네이비 톤 패널, 계약당 다음 행동 1건, 60일 이내) | §3.2 홈 |
| P2 | 계약 상세 최상단에 **"다음 행동"** (상태 → 다음 행동 → D-Day → 금액/다음 결제 → 기간 → 갱신/해지 → 기타) | §3.4, §2.7 |
| P3 | 캘린더 색상 체계 고정 + 범례 텍스트, **월 계약 지출 예정** 금액을 상단에 크게 | §3 캘린더, §6 |
| 기타 | "내 계약 N개를 PACTO가 관리하고 있어요" 문구 / 분석 화면에 정리 항목 체크리스트 / 확인 화면 문구 "AI가 정리한…" / AI 체크 요약은 확인 폼 아래 보조 영역으로 이동 | |

### UX 원칙 (모든 화면 설계 기준)
- PACTO는 구독관리 앱이 아니다. 단순 캘린더 앱이 아니다. AI 법률분석 앱이 아니다.
- PACTO는 **"내 모든 계약을 한곳에서 관리하는 계약 지갑"**이다. 계약이 쌓일수록 언제 시작했고, 언제 끝나고, 언제 돈이 나가고, 언제 해지해야 하고, 언제 갱신되는지를 PACTO가 기억한다.
- 강조 순서: **계약 관리 → 일정 → 지출 → 종료/갱신 → AI 체크**.

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
| A | **"이번 달 지출"의 정의** | **확정**: 홈 메인 = **이번 달 실제 결제 예정액**("10월 계약 지출"). 연납 보험료는 실제 결제되는 달에만 포함. 보조 지표 = **매달 나가는 정기 계약비**(앞으로 12개월 안에 결제가 남은 확정 정기 결제의 월 환산, 일시불 제외). 개정 7: 월평균(연간 ÷ 12)·연간 예상은 일시불(예: 헬스장 1년권 660,000원)을 매달 나가는 돈처럼 섞어 삭제 |
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

### 2.7 다음 행동 (Next Action) — `src/domain/nextAction.ts`
- 후보 = 계약 일정(`contractSchedule`: 해지 통보기한 · 종료 · 자동갱신 · 사용자 일정) + 계약 종류별 준비 시점. 가장 가까운 것이 "다음 행동", 없으면 다음 결제.
- 같은 날이면 우선순위: 해지 통보기한 > 사용자 일정 > 준비 시점 > 자동갱신 > 종료.
- 계약 종류별 문구/준비 시점은 `CATEGORY_PROFILES`에서 관리 (법적 판단 없이 확인 안내만):

| 종류 | 종료 이름 | 추가 시점 |
|---|---|---|
| 자동갱신 계약(공통) | 자동갱신 예정 + 해지 통보기한 | — |
| 보험 | 보험 만료 | — |
| 렌탈 | 렌탈 계약 종료 (반납·소유권 이전 조건 확인 안내) | — |
| 부동산(전세 등) | 계약 만기 | 만기 60일 전 "갱신 여부 확인" |
| 통신 | 약정 종료 | — |
| 회원권 | 회원권 만료 (자동갱신이면 갱신/해지 시점) | — |
- DB 단계: `contract_events`(사용자·AI 일정) + 계산 일정이 같은 후보 목록으로 들어가므로 구조 변경 없이 확장. 홈 "지금 확인이 필요한 계약"도 같은 함수(`attentionItems`)를 사용.

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
| 1 | **이번 달 실제 계약 지출** | "10월 계약 지출 ₩1,250,300" + 보조(매달 나가는 정기 계약비) + 카테고리 분해 | 화면에서 가장 큰 숫자 |
| 2 | **지금 처리해야 할 계약** | "지금 확인이 필요한 계약 2건 — 전세계약 D-25 / 헬스장 해지 통보기한 D-57" | **개정 2: 홈 최상단(순서 1)으로 이동.** 계약별 다음 행동 1건, 60일 이내, 연한 네이비 패널로 강조 |
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
│  │  ├─ spending.ts        monthSpending, recurringMonthlyCost, monthlyEquivalent
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

**브랜드 (2026-10-05 수령 시안 반영)**
- 심볼: 기울어진 카드 3장이 겹친 형태 (앞 2장 네이비, 뒤 1장 스카이블루). 앱 아이콘은 네이비 배경 + 흰 카드.
- 워드마크: 기하학적 산세리프 "PACTO", A는 가로획 없는 Λ. 앱에서는 시안을 측정해 만든 벡터(`src/components/brand/geometry.ts`)로 표시 — **원본 SVG/AI 파일을 받으면 교체**.
- 브랜드 색: 네이비 `#142C4C`(아이콘 배경 `#102848`), 스카이 `#7894BC`, 단색 `#252525` (시안 이미지에서 측정한 값).
- 워드마크 서체 이름은 확인되지 않음. 본문(한글) 서체는 별도 결정 필요 (후보: Pretendard).
- 아이콘/스플래시/파비콘은 `npm run brand:assets`로 심볼에서 생성.

**캘린더 이벤트 색상 (고정, 항상 범례 텍스트 병기)**: 결제(돈이 움직이는 날) = 네이비 `#142C4C` · 통보기한 = 레드 `#D6393A` · 종료·만기·갱신·확인 시점 = 앰버 `#C27A0E` · 시작·주요 날짜(입주·설치·실행 …) = 라이트 블루 `#7894BC` · 내 일정 = 그레이

**날짜 의미와 일정 매핑 (고정)**
- 계약 체결일(`contract_date`)·계약 시작일(`start_date`)·계약 종료일(`end_date`)·결제일(`payment_day`)은 서로 다른 값이며 섞지 않는다.
- 시작 일정은 시작일에서만 생성 (체결일은 일정을 만들지 않음). 결제 일정은 결제 규칙(주기·결제일·회차)에서만 생성. (개정 3: 유형별 이름)
- 시작·종료·해지 통보기한·갱신은 계약 필드에서 **파생**되므로 저장하지 않는다 → 수정하면 자동으로 다시 계산된다. 사용자/AI 일정만 `contract_events`에 저장.
- 같은 날 여러 일정 → 점 여러 개(유형 색별) + 리스트 여러 줄. 지출은 결제 일정만 합산.
- 날짜 입력은 공통 `DateField`: `261012`/`20261012` → `2026-10-12` 자동 변환, 존재하지 않는 날짜(13월, 평년 2/29)는 오류.
- AI 추출 프롬프트: v2에서 체결일/시작일/결제일 구분 → v3에서 날짜·금액 의미 분류로 확장 (개정 3).

**의미 해석 → 관리 데이터 (개정 5, extract-v5)** — 숫자·날짜를 발견했다고 곧바로 결제·일정으로 만들지 않는다. 원문 추출 → 의미 해석 → 조건 판단 → 관리 데이터.
- 금액 역할(role): recurring_cashflow / one_time_cashflow / deposit만 결제가 된다. component는 상위 결제의 `components`(표시용, 합산 안 함), total·reference는 확인 화면의 "결제에 넣지 않은 금액".
  서버 안전장치: role 없이 "포함·구성"이라고 적힌 정기 금액이 더 큰 같은 방향·주기 금액과 함께 있으면 구성 항목으로 본다.
- 값 출처(`contracts.value_sources`): explicit(계약서 명시) / inferred(AI 추정 — "AI 추정" 배지, 확인 필요) / calculated(PACTO 계산 — "PACTO 계산" 배지) / user_confirmed(사용자가 고치거나 확인).
  추정·계산된 숫자 속성(예: 월 임금으로 만든 연봉)은 저장하지 않는다.
- 실제 지급일(`contract_payments.business_day_rule`): 명목일이 주말·공휴일이면 직전/다음 영업일. 공휴일은 고정 공휴일만 내장(`registerHolidays`로 확장) — 설날·추석·대체공휴일은 아직 없음.
- 기간별 금액: 수습기간(입사일부터 N개월) 동안 급여 × 비율, 수습 종료 예정일은 주요 날짜로 파생.
- 계약 체크 behavior: info / fixed_event / conditional_rule. 조건부 의무(자진 퇴직 30일 전 통보, 중도해지 위약금, 연체 …)는 날짜·다음 행동·통보기한을 만들지 않고,
  사용자가 기준일을 입력할 때만 기준일 − N일 일정을 만든다. 종료일 기준 통보기한은 자동갱신(또는 갱신을 관리하는 유형)에서만.
- 계약 체크 등급: 핵심 정보 / 확인 필요 / 주의 필요. "다음 행동"은 실제로 할 일만 (종료는 180일 이내, 할부·대출은 90일 이내).

**금액의 의무 수준 (개정 6, extract-v6)** — 금액 + 날짜가 발견됐다고 결제가 아니다. 금액 발견 → 의미 → 실제 의무인지 → 조건 여부 → 결제 일정 생성 여부.
- `contract_payments.obligation`: confirmed(확정) / optional(선택형, 이용 시) / conditional(조건부, 상황 발생 시) / potential(발생 가능) / informational(참고 금액), `condition_note`(언제 내는 돈인지).
- 캘린더·지출·알림·월 환산은 confirmed만 (`expandPayment`·`paymentMonthlyEquivalent`에서 한 번에 거른다). 나머지는 상세 "추가로 발생할 수 있는 비용"에만.
- 조건이 실제로 생기면 사용자가 날짜를 정해 결제로 전환(`activateCost`): 선택형은 그날부터 정기 결제, 조건부는 그날 1회.
- 서버 안전장치: 양도·분실·파손·연체·위약·중도해지/상환·초과·원상복구·손해배상·미반환 단서 → conditional, "(선택)·신청 시·특약" → optional,
  다른 확정 결제가 있는 "이용 시" 부가 비용 → optional, "일시불·1회 결제" 금액은 이용 기간과 무관하게 one_time.

**톤: 법률사무소가 아니라 금융/자산관리 앱.** 첫 화면 인상 = "내 계약을 보관하고 관리하는 금융 지갑".

- 화이트 중심. 배경 `#FFFFFF`, 섹션 구분 배경 `#F4F6F9` 정도의 아주 옅은 회색, 본문 `#191F28` 계열 진회색.
- Primary: **브랜드 네이비 `#142C4C` 1색**, 보조 `#7894BC`(장식용). 보라색·그라데이션·네온 금지.
- 강조 대상은 **D-Day와 금액**. 그 외 요소는 무채색으로 물러나게.
- AI 관련 UI에 반짝이(✨)·보라 계열·로봇 아이콘 등 "AI 앱" 시그널 사용 금지. "자동 정리" 같은 기능 언어 사용.
- 시맨틱: 주의 필요 = 레드 계열, 확인 필요 = 앰버 계열, 핵심 정보 = 그레이. 색만으로 구분하지 않고 라벨 텍스트 병기(접근성).
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

### 캘린더 요약 카드 (개정 9)

- 일정 원본(결제·시작·주요 날짜·통보기한·만기 …)은 지금처럼 계약 정보에서 각각 계산·저장하고, **화면에서만** 같은 계약 + 같은 날짜를 카드 하나로 묶는다(`src/domain/calendarGroups.ts`, view model `CalendarContractGroup`). 계약이 다르면 같은 날·같은 회사여도 따로.
- 대표 문구: 해지 통보기한 > 자동갱신 > 종료·만기 > 확인 시점 > 결제 > 시작 > 주요 날짜 > 내 일정. 행동이 필요한 일정은 금액보다 위에 강조.
- 같은 의미의 시작 일정은 하나로: 이용 시작 + 설치일 → "이용 시작", 개통일 → "개통", 입사일 → "근무 시작", 입주일 → "임대차 시작 · 입주", 시작 일정이 없는 유형의 인도일 → "인도".
- 금액: 확정 결제만(선택형·조건부·잠재·참고는 원래 일정에 들어오지 않음) 방향별 합산 — 지출 "49,900원 결제 예정", 수입 "+3,600,000원 급여/입금 예정", 중립(보증금) "· 지출 합계 제외". 세부 내역은 3건까지 + "외 n건".
- 월 지출 합계는 이 묶음과 별개로 결제 규칙에서 직접 계산(`spending.ts`) → 묶어도 합계 변화 없음. 날짜 점은 종류별 1개(행 수만큼 찍지 않음). 카드를 누르면 계약 상세에서 원본 일정 전체 확인.

### 알림 묶기 (개정 10)

- 알림 원본(`upcomingReminders`: 결제 한 건·통보기한·만료·갱신 하나당 하나)은 그대로. 발송·화면은 `src/domain/reminderGroups.ts`에서 **같은 계약 + 같은 알림 날짜(fireOn)** 를 알림 하나로 합친다 → 푸시도 묶음 하나당 한 번(푸시 연결 시 `groupReminders` 결과를 발송 단위로 사용).
- 대표: 해지 통보기한 > 자동갱신 > 만료 > 결제. 결제만 있으면 "내일 49,900원 결제 예정이에요." + "월 렌탈료 29,900원 · 설치비 20,000원". 수입은 "+… 입금 예정".
- 알림 날짜(오른쪽 "10월 11일 · 알림 예정")와 실제 일정 날짜("일정 · 10월 12일 월 렌탈료 · 설치비 결제")를 따로 표시.
- 화면 목록: 같은 계약의 결제만 있는 알림은 가장 가까운 것만 펼치고 이후는 "이후 매월 11일 알림 예정"(매달 같은 날이 아니면 "이후 알림 n건 더"). 통보기한·만료·갱신 알림은 줄이지 않는다.

### 알림 중요도·출처 (개정 11)

- 공통 규칙 `src/domain/notificationPriority.ts` — 알림·캘린더·다음 행동이 같이 쓴다 (화면 컴포넌트에 판단 로직 없음).
- **중요도**(AI 신뢰도와 별개): critical = 해지·종료 통보기한(+ 갱신 통보·옵션 행사·청구 기한 등 확장 타입) / important = 만기·종료·자동갱신 예정일·보증금 반환·PACTO 사전 안내 / normal = 결제·입금·시작·주요 날짜·내 일정.
  critical은 확인된 값에서만: **PACTO 기본 안내는 critical 불가**, AI 추정값(valueSources = inferred)에서 나온 기한은 important + "확인 필요".
- **출처**(일정 날짜의 출처 — 알림 시점과 별개):
  `contract` 계약서 기준(업로드한 계약서에서 읽어 저장) · `manual_entry` 입력한 계약 정보 기준(계약서 없이 직접 입력 — 중요도는 낮추지 않음) ·
  `legal` 법령 기준(**V1에서는 만들지 않음**, `LegalRule`/`LegalRuleVersion` 구조만 — 법정 기간을 코드 숫자로 두지 않는다) · `pacto` PACTO 안내 · `user_custom` 직접 설정.
- **임대차 만기 60일 전 "갱신 여부 확인"은 PACTO 기본 안내**(계약서·법령 기한 아님) — 알림 카드·캘린더(보조 줄 포함)·다음 행동 모두 "PACTO 안내"로 표시.
- 통보기한 사전 알림 30·7·1·0일 전은 **PACTO 알림 정책**(기한을 만드는 규칙이 아님). 카드에서 "입력한 계약 정보 기준 · 2027. 6. 21."과 "PACTO가 30·7·1일 전과 당일에 미리 알려드려요"를 다른 줄로.
- 알림 화면: "중요한 계약 일정"(critical/important, 앞으로 12개월·최대 5개 = **화면 표시 범위일 뿐**, 범위 밖 일정도 계산·캘린더에 그대로; `total`로 "더 보기" 확장 가능) → "알림 규칙"(PACTO가 언제 알려주는지, `reminderPolicySummary()` — REMINDER_RULES에서 생성).
  결제 전날 알림을 하나씩 나열하는 "다음 알림" 목록은 캘린더·홈과 중복이라 두지 않는다(개정 12). 알림 묶기(`groupReminders`)는 푸시 발송 단위로 유지하고, 푸시 연결 후 그 자리에 "받은 알림" 기록을 둔다.
  카드는 아이콘·제목·라벨(중요/기한 임박/확인 필요/확인)·테두리·문구를 함께(색만으로 구분하지 않음). 계약서 기준 일정은 관련 계약 체크의 근거 문장·쪽을 연결(민감정보 가림 적용), 없으면 근거를 만들지 않는다.
- DB 변경 없음. 향후: `contract_event_type` 값 추가(새 행동 일정 저장 시), 필드별 근거 저장, `notification_rules`·발송 기록(푸시 연결 시).

### 사진 촬영 등록 · 문서 확인 게이트 (개정 13, extract-v7)

원칙: **파일을 올린 것과 계약서로 인정하는 것은 별개** — 파일 확인 → 계약 관련 문서인지 → 읽을 수 있는지 → 계약일 때만 분석 → 사용자 확인 → 저장.

- **등록 방식**: PDF 업로드 / 사진으로 등록(시트: 지금 촬영하기 · 앨범에서 선택) / 직접 입력. 촬영은 `src/features/registration/camera.ts`(expo-image-picker `launchCameraAsync`, Expo Go 호환) — 페이지마다 시스템 카메라를 다시 열고, `register/capture`에서 썸네일·삭제·다시 촬영·최대 10장. 문서 스캐너(expo-camera)로 바꿀 때는 이 모듈만 교체.
  촬영·앨범 모두 같은 흐름(prepareFile: HEIC→JPEG, 긴 변 2400px, 품질 0.85 → 보관 → 보호 → 문서 확인·분석). 촬영 임시 파일은 등록이 끝나면(저장·취소) 지운다.
- **업로드 전 점검(AI 비용 없음)**: 긴 변 800px 미만 → "계약 내용을 읽기 어려워요"(서버에 파일 안 남김), 같은 사진(크기·가로·세로 동일) → 한 번만.
- **AI 1회 호출에 결합**(별도 판정 호출 없음): 응답에 `document_check`(역할 contract/addendum/supporting/non_contract/uncertain/unreadable · 신뢰도 · 이유 코드 · 계약 신호 8종 · 파일·쪽별 역할·중복) + 계약 추출.
  계약이 아니거나 읽을 수 없으면 계약정보를 추측해 만들지 않도록 프롬프트에 명시하고, 모든 추출값에 근거 파일(evidence_file)·쪽(evidence_page). 스키마 한도(객체 속성 100·중첩 5) 안에 맞추려고 공통 필드를 키 목록으로(속성 83개).
- **서버 게이트**(`_shared/documentGate.ts`, `_shared/analysis.ts` — 순수, 앱 테스트 공용):
  unreadable → 다시 촬영 / non_contract → 분석 중단 / 신호 0~1 → 정보 부족 — 셋 다 **추출 결과를 앱에 보내지 않음**(확인 화면·계약·결제·일정·알림 없음, 보관본 정리).
  contract·addendum + 신뢰도 high/medium + 신호 3개 이상 + 날짜 또는 금액 → 진행. 날짜·금액이 없어도 강한 신호(당사자·의무·계약형 문장)거나 신호 2개, 관련 자료(supporting)만, 판단 어려움, 신뢰도 low → **사용자 확인**("계약 관련 문서가 맞아요" → `role_confirmed_by_user`, AI 재호출 없이 보관한 결과 사용).
  신호는 모델 판단 + 근거 있는 추출값으로 서버가 다시 센다(모델이 "있다"고 해도 근거 값이 없으면 불인정).
- **의심 쪽**: 사진은 쪽 선택([N페이지 제외] / [그대로 포함]) 후에만 결과를 보낸다. **제외·계약과 무관·읽기 어려운 쪽에서만 근거가 나온 값은 결과에서 제거**(모델 출력 단계에서 필터 → 앱 형식 변환). 근거 위치를 모르는 값이 있으면 그 사진을 빼고 **다시 분석**(새 작업). 제외한 사진의 보관본은 앱이 지운다.
  PDF는 의심 쪽 번호 안내만(쪽 삭제 없음) — 그 쪽 근거 값은 빼고, 위치를 모르는 값은 "확인 필요"로 낮춘다. 사용자가 "그대로 포함"을 고른 쪽의 값은 유지.
- **DB**(`20261011000001_document_validation.sql`): `contract_documents.document_role`·`role_confirmed_by_user`(사용자 변경 불가 트리거), 계약이 아니거나 읽을 수 없는 문서는 사용자 확인 없이 계약에 연결 불가(`document_not_contract`). `analysis_jobs.validation`(원문 없음)·`raw_output`(사용자 선택 반영용, Level 1 가림, **앱이 읽지 못함** — 컬럼 권한).
- **고아 파일 정리**: `cleanup-orphans`(매시간 pg_cron → pg_net, `x-cleanup-secret`). 계약 미연결 + 생성 24시간 경과 + 그 문서·사용자의 분석 작업이 진행 중 아님 → `claim_orphan_documents`가 행을 지우고(영역·파생본 기록 cascade) 원본·보호 파생본 파일을 Storage API로 삭제. 24시간 지난 미연결 분석 작업 삭제, 남는 작업의 raw_output 비움. 로그는 문서 id·결과·개수만.
- **사진 마스킹**: 사진은 private 보관·AI 분석·등록 가능, 자동 가리기 미지원(`unsupported_scan`/`image_file` — "사진으로 등록한 계약서" 안내, 보호됨으로 표시하지 않음).
- **로그**: 작업 id·역할·신뢰도·판정·파일 수·의심 쪽 수·신호 수·시간.
- 테스트: `document-gate.test.ts`(A~L·신호 기준·쪽 제외·재분석·중복·사용자 확인), `step12-document-gate`(Deno 함수·DB 가드·고아 정리), `e2e/photo-gate.js`(시트·음식·저해상도·의심 쪽 제외·중복·촬영).

### 7.x 계약서 민감정보 보호 (개정 8, V1)

원칙: **원본은 절대 수정하지 않는다 → 민감정보 탐지 → 기본은 보호 표시본 → 필요할 때만 원본(확인 후) → (향후) 공유는 보호본.**

| 역할 | 파일 | V1 |
|---|---|---|
| `original` | `contract-files/{user}/{doc}.{ext}` — 업로드 원본, 수정·덮어쓰기 없음 | ✅ |
| `protected_view` | `contract-files/{user}/{doc}.protected_view.pdf` — 민감한 글자를 **실제로 제거**한 표시본 | ✅ |
| `redacted_share` | 제3자 공유용 (워터마크 등) | 구조만 (`document_derivatives.kind`) |

- **처리 위치**: Edge Function `protect-document` (외부 전송 없음). 업로드 직후·AI 분석 전에 실행. 기존 문서는 상세의 "민감정보 보호하기"로만.
- **실제 제거(redaction)**: 콘텐츠 스트림의 글자 표시 연산자(Tj/TJ/'/")에서 해당 글자 코드를 지우고 같은 너비만큼 TJ 이동으로 대체 → 나머지 배치는 그대로.
  보호본은 새 문서에 페이지만 복사해 만든다(교체 전 스트림·메타데이터·북마크·첨부·주석·입력 양식·대체 텍스트가 남지 않음).
- **위치 신뢰성 확인(처리 전)**: 원본을 pdf.js(별도 구현)로도 읽어, pdf.js 텍스트 조각의 시작·끝 글자가 같은 위치에 우리 추출 글자로도 있는지 본다(95% 미만이면 `failed`/`text_mismatch`).
  pdf.js 원본 텍스트에서만 보이는 Level 1 정보가 있어도 `text_mismatch` (잘못된 "감지되지 않음" 방지).
- **독립 검증(보호본)** — 하나라도 걸리면 `failed`/`verification_failed` (보호본 저장 안 함):
  ① 위치 기반: 지워야 했던 글자(원문 문자)가 보호본의 **같은 자리**에서 다시 읽히는가 — 우리 추출기(글자 단위)와 pdf.js(조각 내 비율 추정)로 각각, 글자 상자 가장자리 20% 여유.
  다른 위치에 같은 숫자 조각(예: 다른 카드의 끝 4자리 `1111`)이 보이는 것은 누출이 아니다 (예전 부분 문자열 검사의 오탐 원인).
  ② 값 전체: 가린 값 전체가 같은 쪽 어느 줄에 남았는가 (숫자형은 공백·하이픈·점을 빼고 비교 — `4111-1111-…` = `4111 1111 …`).
  ③ 놓친 Level 1 정보가 보이는가. 검증에 쓰는 원문은 처리 중 메모리에서만 쓰고 DB·로그에 남기지 않는다(로그는 개수·종류·단계만).
- **지원 글꼴**: Type0 Identity-H, **미리 정의된 한글 CMap 가로쓰기**(UniKS-UCS2/UTF16/UTF8/UTF32-H, KSC-EUC-H, KSCpc-EUC-H, KSCms-UHC(-HW)-H, KSC-Johab-H — ToUnicode가 없으면 Adobe-Korea1 CID→유니코드 표),
  Type1/TrueType(Widths, 없으면 표준 14 글꼴 글자 너비표 — Helvetica·Times·Courier와 Arial 등 별칭), **Type3**(회전·기울임 없는 FontMatrix + ToUnicode 필수, Chrome 인쇄 PDF).
  세로쓰기(-V)·한글 외 CMap·내장 CMap 스트림·ToUnicode 없는 Type3 → `failed`/`unsupported_font` (스캔본으로 분류하지 않음). 한글 CMap 데이터는 pdfjs-dist 6.1.200 `cmaps/`(Adobe, BSD-3)를 `_shared/vendor/korean-cmaps.js`로 내장하고 pdf.js 검증에도 같은 데이터를 쓴다.
- **상태**(`contract_documents.protection_status`): `pending` / `protected` / `no_sensitive_data`("감지되지 않음", 없다고 단정하지 않음) / `unsupported_scan`(사진·스캔본·투명 OCR층 — 텍스트+스캔 혼합 문서는 전체) / `failed`(암호화·해석 불가 글꼴(`unsupported_font`/`undecodable_font`)·위치 불일치(`text_mismatch`)·입력 양식·검증 실패 등). 서버(service_role)만 바꿀 수 있다(트리거).
- **탐지**(`_shared/protection/sensitive.ts`): 패턴 + 바로 앞 필드명(문맥) + 검증(생년월일·성별 자리·Luhn). 계약번호·증권번호·고객번호·사업자/법인등록번호·차대번호 등 필드명 뒤 숫자는 제외.
  Level 1(주민·외국인등록번호·카드·계좌) 자동 가림, Level 2(전화·이메일) 부분 가림, Level 3(이름·회사)는 계약 이해에 필요해 표시. 신뢰도: high 가림 / medium 가림 + "확인 필요" / low 가리지 않는 후보.
- **저장**(`document_sensitive_regions`): 위치(0~1 bbox)·종류·신뢰도·가림 상태·**이미 가린 표시값**만. 원문 값·해시는 저장하지 않는다. 사용자는 `state`·`user_confirmed`만 변경 가능.
- **세 가지를 분리**: ① 화면 가리기 = 보호 표시본 ② 공유용 제거 = `redacted_share`(다음 단계) ③ AI 전송 전 제거(다음 단계).
  별도로 AI 결과(인용문·설명·값)의 Level 1 원문은 서버가 저장·반환 전에 가리고(`maskLevel1Deep`), 앱은 표시 직전에 한 번 더 가린다.
- **보기**: 기본 "보호된 계약서 보기". "원본 보기"는 `requireReveal()` 한 곳을 거친다(V1 확인 대화상자, 향후 생체인증·PIN).
- **삭제**: 계약 삭제·초안 폐기 시 원본 + 파생 파일을 먼저 지우고 행을 지운다(영역·파생본 기록은 cascade). 회원 탈퇴는 사용자 폴더 전체 삭제.
- **로그**: 문서 id·상태·종류별 개수·시간만.
- **라이브러리**: pdf-lib 1.17.1(MIT)·unpdf 1.8.1(pdf.js, Apache-2.0)을 `scripts/vendor-pdf.mjs`로 고정 번들(`_shared/vendor`). MuPDF는 AGPL이라 사용하지 않음.
- **화면 문구**: `unsupported_scan` → 특수 형식 페이지만 "자동 가리기를 지원하지 않는 형식의 페이지가 있어요"(개정 20 — 일반 스캔 페이지는 OCR로 보호) / `failed` → "민감정보 보호 처리 중 문제가 발생했어요." (+ 사유별 짧은 안내)
- **테스트**: `npm run test:protection`(Node 내장 테스트 — 실제 제거·구조 분석·상태·반복 숫자 회귀·눈으로만 가린 경우 실패·pdftotext 교차 확인·한글 CMap·Type3·위치 불일치), `step11-protection`(통합, Deno Edge Function), `e2e/protection-flow.js`.
  진단: `npm run diagnose:pdf -- <파일>` (상태·개수만 출력, 원문 없음).
- **다음 단계**: ~~OCR 기반 스캔본 보호~~(개정 20), 주소·여권·면허·서명·도장, 사용자 직접 가리기·이름 가리기, 공유용 보호본, AI 전송 전 redaction, 입력 양식 PDF.

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
| 홈 지출 숫자 | 이번 달 실제 결제 예정액 (보조: 매달 나가는 정기 계약비 — 개정 7) |
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
- 2.2 `dates`(서울 기준 오늘, 말일 보정), `dday`, `status`(상태·현재 회차 종료일·해지 통보기한), `schedule`(결제 전개·시스템 일정 생성), `spending`(이번 달 실제 결제 예정액, 매달 나가는 정기 계약비, 카테고리 분해), `actions`(홈 "지금 처리해야 할 계약"), `money`
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
- 10.2 이번 달 지출/카테고리 분해/매달 나가는 정기 계약비(종료 계약·일시불 제외, 개정 7)
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

### 결제 날짜 해석 · 날짜 출처 (개정 14, extract-v8)
- 문제: 임대차 샘플에서 계약금("계약 당일 지급")이 2026-10-20으로 저장됨. 원인 두 가지 — (가) 모델이 날짜를 비우면 저장 시 `draftToPayment`가 계약 시작일로 채움, (나) 모델이 같은 표의 잔금 날짜를 옮겨 적으면 그대로 사용.
- `payments[].date_source`: `explicit | contract_date | balance_date | move_in_date | start_date | end_date | calculated | inferred`. 프롬프트: 날짜는 그 금액의 문구만 보고 정하고, 같은 표·섹션의 다른 날짜를 옮기지 않는다.
- 서버 `resolvePaymentDate`(extraction.ts): 기준 날짜(contract_date 등)면 모델이 적은 date 대신 dates의 해당 의미(contract_signed·balance_due/move_in·move_in·contract_start…·contract_end/maturity) 날짜를 쓴다. 없으면 null(다른 날짜로 대신하지 않음).
  안전장치: explicit인데 근거 문구에 그 날짜가 없으면 문구의 기준 표현("계약 당일·계약 시·계약 체결 시", "잔금일에", "입주일·입주 시", "시작일에", "종료일·만기")으로 바꾸고, 기준 표현도 없으면 inferred로 낮춘다(날짜는 두고 "확인 필요").
- 앱: 기준 날짜로 정한 금액은 "계약서에 '계약 당일'로 적혀 있어 계약일(…)로 넣었어요." 안내. 기준 날짜가 없거나 calculated·inferred면 "확인 필요".
- 한계: 근거 문구(evidence_quote)가 없는 값은 안전장치로 검사할 수 없다. date_source는 확인 화면까지만 쓰고 DB에는 저장하지 않는다.
- 테스트: `scenario-lease-dates.test.ts` (계약금 2026-10-08 · 잔금 2026-10-20 · 월세·관리비 매월 20일 · 모델 응답 6가지 · 기준 표현 규칙).

### 실제 푸시 알림 (개정 15)
- **구조 (서버 중심)**: 앱은 권한·토큰 등록·설정만. 계산·발송은 Edge Function `notifications`.
  - 계약·결제·날짜·일정·설정 변경 → DB 트리거가 `notification_plan_queue`에 사용자 추가 (+ 앱이 저장 직후 `action=plan`으로 바로 계산 요청)
  - pg_cron 5분마다 `action=tick`: 대기열 계산 → `claim_due_notifications`(SKIP LOCKED, scheduled→processing) → Expo Push → sent/재시도/failed → 15분 지난 발송의 수신 결과 확인
  - 매일 00:07(한국)에 모든 사용자 재계산 — 반복 결제는 앞으로 35일(`PLAN_WINDOW_DAYS`) 안의 알림만 만든다
- **계산은 앱과 같은 코드**: `src/domain/notifications.ts`(설정 병합 → 일정·기한 → 시간대·알림 시각 → 같은 계약·같은 시각 묶기 → dedupe 키). 서버는 `scripts/vendor-domain.mjs`가 만든 번들(`_shared/vendor/pacto-domain.js`)을 쓴다. 원본을 고치면 번들을 다시 만들어야 하고, `domain-bundle.test.ts`가 어긋남을 잡는다.
- **설정 우선순위**: PACTO 기본값(`REMINDER_RULES`) → 사용자 전체(`notification_preferences`) → 계약별(`contract_notification_overrides`). 시점은 선택지만(당일·1·3·7·14·30·60·90일 전, 계약별은 180일 전까지, DB check로도 제한).
- **시간대**: `profiles.timezone`(기본 Asia/Seoul)을 쓴다. 기기 시간대가 바뀌어도 자동으로 바꾸지 않고, 사용자가 설정에서 바꿀 때만. 알림 시각은 `resolveSendTime` 한 곳(방해 금지 시간 등은 여기에 추가).
- **중복 방지**: `dedupe_key` UNIQUE(사용자·발송 시각·담긴 일정 키) + 같은 계약·같은 시각 `group_key` 부분 UNIQUE(scheduled/processing/sent) → 같은 시각에 두 번 보내지 않음. `notification_deliveries`는 (알림, 토큰) UNIQUE.
- **재시도**: 일시적 오류만 5·15·60분 뒤, 3번 실패하면 failed. 24시간 넘게 늦으면 expired. `DeviceNotRegistered` → 토큰 비활성화.
- **삭제·끄기**: 계약 삭제 → 예정 알림·발송 기록 cascade. 발송 직전에도 계약 알림·전체 알림이 꺼졌는지 다시 확인(cancelled). 로그아웃 → 이 기기 토큰 비활성화.
- **잠금화면 문구**: 기본(`profiles.push_preview_enabled=false`)은 "확인할 계약 일정이 있어요." / critical·important는 "확인할 계약 기한이 있어요." — 계약명·금액은 사용자가 "알림에 계약 상세 표시"를 켤 때만. 주민번호·계좌·원문은 넣지 않는다. 문구 생성은 `buildNotificationMessage` 한 곳.
- **눌렀을 때**: `/contract/{id}?from=push&event=…&check=…` → 계약 상세 상단 "알림에서 열었어요" + 관련 조항 보기(계약서 기준 일정의 계약 체크).
- **Expo Go**: SDK 53부터 원격 푸시 미지원 → 앱은 Expo Go·웹·시뮬레이터에서 expo-notifications를 불러오지 않고 "이 기기에서는 받을 수 없어요"만 안내. 실제 수신은 EAS 빌드(preview APK)에서.
- **테스트 알림**: 서버 `ALLOW_TEST_PUSH=true`일 때만, 앱은 개발 모드 또는 `EXPO_PUBLIC_SHOW_PUSH_TEST=true` 빌드에서만 버튼 표시. 10초 뒤 보내기(앱을 닫은 상태 확인용).
- **법령 알림**: V1에서 만들지 않음. 임대차 "만료 60일 전 갱신 여부 확인"(PACTO 안내)은 화면의 중요한 계약 일정에만 있고 푸시 대상은 아님.
- 테스트: `notifications.test.ts`(A~F·K~O·시간대·미리보기), `push-outcome.test.ts`, `step13-notifications`(통합: C·D·E·F·G·J·재시도·만료·수신 결과·RLS), `e2e/push-settings.js`.
- **알림 화면 역할 (개정 15-1)**: 알림 화면 = 중요한 계약 일정(critical·important, critical 먼저 → 날짜순, 최대 5개) + 알림 설정 요약 + 캘린더 링크. 앞으로 보낼 푸시 목록("다음 알림")은 보여주지 않는다 — 미래 일정은 캘린더, 실제 알림은 푸시. `scheduled_notifications`·planner·발송은 그대로. 카드 날짜는 실제 계약 일정 날짜(발송 시각 아님), 알림 시점은 사용자 설정이라 카드에 적지 않는다. 푸시를 끈 상태(전체 끄기·권한 거부)는 "알림이 꺼져 있어요" + 설정 버튼, 중요 일정은 계속 표시.

### 통보기한의 의미 notice_kind (개정 16, extract-v9)
- 문제: "종료 N일 전"이라는 숫자 하나(`termination_notice_days`)를 모두 "해지 통보기한(critical)"으로 다뤄, 계약서가 "갱신 여부를 협의"라고만 적은 경우도 통보 의무처럼 보였다.
- `contracts.notice_kind`: `termination_notice`(해지·종료 의사 통지 기한, critical) / `renewal_notice`(갱신 또는 갱신 거절 의사 통지 기한, critical) / `renewal_decision`(갱신 여부 확인·협의·결정 시점, important) / `unknown`(숫자는 있으나 의미 불확실, important + 확인 필요). 기본값 unknown, 기존 계약은 모두 unknown — 자동으로 다시 분류하지 않고 사용자가 계약 수정에서 고른다(○ 해지·종료 통보기한 ○ 갱신 통보기한 ○ 갱신 여부 확인·협의 ○ 잘 모르겠어요). `save_contract`는 수정 시 값이 없으면 기존 값을 유지.
- 도메인: `src/domain/noticeKind.ts` 한 곳에서 이름·문구·일정 종류를 정한다. 일정 항목 type은 그대로 `termination_notice`(캘린더 색·순서), actionType이 종류별(`termination_notice` / `renewal_notice` / `renewal_decision` / `notice_unknown`)이고 중요도는 `notificationPriority.ts`(renewal_decision·notice_unknown = important). unknown은 항상 needsReview(확인 필요).
  계약서의 갱신 여부 확인 시점(renewal_decision)이 있으면 임대차 PACTO 기본 안내(만기 60일 전 갱신 여부 확인)를 따로 만들지 않는다(같은 날 중복 방지).
- 문구: "갱신 여부 확인까지 682일 남았습니다." / "계약서에 따라 2028년 8월 20일까지 갱신 여부를 상대방과 협의해주세요." / "해지 통보기한까지 30일 남았습니다." / "갱신 통보기한까지 30일 남았습니다." / unknown: "통보·갱신 관련 기한이 있어요." + "이 일정의 의미를 확인해주세요." 직접 입력한 계약은 "입력한 계약 정보에 따라".
- AI(extract-v9): `fields.noticeKind`를 일수와 같은 조항 근거로 받는다. 서버 `resolveNoticeKind` 안전장치 — 근거 문장에 협의·확인 표현만 있고 통지 표현(통지·통보·알려·고지·의사표시·서면으로·신청)이 없으면 모델 답과 관계없이 renewal_decision(원문보다 강하게 바꾸지 않음). 모델이 답하지 않았거나 unknown·확신 낮음·근거 문장 없음이면 unknown. 앱은 unknown이거나 high가 아니면 "확인 필요".
- 알림 설정: 종류별 키 `termination_notice` / `renewal_notice` / `renewal_decision`을 따로 저장(DB `valid_notification_categories` 확장). 화면은 "해지·갱신 통보기한"(termination_notice + renewal_notice에 같이 저장) / "갱신 여부 확인"으로 묶어 보여준다. 저장값이 없을 때 renewal_notice는 기존 termination_notice 설정을 이어받고(읽을 때 계산 — 저장된 사용자 데이터는 바꾸지 않음), renewal_decision은 PACTO 기본값(30·7일 전)에서 시작. unknown 기한은 놓치지 않도록 해지·종료 통보기한 시점을 쓴다.
- 배포 순서: DB(`supabase db push`) → Edge Function(`analyze-contract`, `notifications`) → 앱 빌드. DB를 먼저 올리지 않으면 새 앱의 저장(`notice_kind`, 새 알림 설정 키)이 거부된다.
- 테스트: `notice-kind.test.ts`(A 협의→renewal_decision·important, B 해지 의사 통지→critical, C 갱신 원치 않으면 통보→문맥 판단 유지, D 불확실→unknown·확인 필요, E 기존 계약 unknown·재분류 없음, 설정 이어받기), `step7-crud`·`step13-notifications`(DB 저장·설정 키), `e2e/notice-kind.js`.

### 앱 실행 화면 (개정 17)
- 순서: 기기 기본 스플래시(app.json `expo-splash-screen`, 흰 배경 + 심볼 이미지) → JS가 그려지는 즉시 브랜드 실행 화면(`BrandSplash`: 심볼 + PACTO + "모든 계약을 한곳에.")으로 바꾸고 기기 스플래시를 내림 → 로그인 확인 → (로그인 상태면) 첫 계약 목록을 `contractsQuery`로 미리 불러온 뒤 180ms opacity로 사라짐.
- 실행 화면은 루트 레이아웃(`src/app/_layout.tsx`)에서 Stack 위를 덮는 방식이라 그동안 하단 탭바·빈 홈이 보이지 않는다. 라우팅 구조는 바꾸지 않았다.
- 로딩 문구는 넣지 않는다. 1.2초(`SPLASH_SPINNER_DELAY_MS`)가 넘을 때만 슬로건 아래에 작은 회색 로딩 표시(자리를 미리 잡아 로고가 움직이지 않음). 15초(`BOOT_MAX_MS`)가 지나면 홈으로 넘기고 홈이 로딩·오류를 보여준다.
- 글자 크기 설정은 1.3배까지만 반영(`maxFontSizeMultiplier`), Safe Area 반영. 슬로건(`BRAND_SLOGAN`)은 개인·가족·기업 계약관리 공통 문구라 특정 유형을 암시하도록 바꾸지 않는다.
- 기기 기본 스플래시는 이미지 한 장만 지원해 문구를 넣지 않았다(아주 짧게 심볼만 보인다).
- 테스트: `e2e/splash.js` (A 로그인 → 홈, B 로그아웃 → 시작 화면, C 느린 네트워크 → 작은 로딩 표시, D 320×568·글자 확대 잘림 없음, E 탭바 숨김).
- (개정 17-1) 최소 노출 시간 `MIN_SPLASH_DURATION_MS = 800` — 앱 시작 시점(`APP_STARTED_AT`, BrandSplash 모듈을 불러온 때)부터 센다. 초기화 완료 AND 최소 시간 경과일 때 전환(200ms → 600ms 더, 700ms → 100ms 더, 1.5초 → 바로). 로딩 표시 1.2초도 같은 시작점 기준이라 로그인 확인 → 데이터 준비로 화면이 바뀌어도 다시 세지 않는다. fade-out 200ms. PACTO 32px SemiBold, 슬로건 17px Medium `textSecondary`(#4E5968, 흰 배경 대비 약 7:1).
- 웹(`web.output: static`)은 JS 실행 전에도 미리 그린 실행 화면이 보여, 웹에서는 실제 노출이 800ms보다 길 수 있다.

### 알림 화면 — 알림 설정 요약 (개정 15-2)
- 알림 화면에서는 종류별 알림 시점을 나열하지 않는다. `notificationSettingsSummary`가 한두 줄만 만든다: 모두 켜짐 "오전 9:00 · 주요 계약 알림 사용 중" / 결제만 꺼짐 "오전 9:00 · 중요 일정 중심" + "결제 알림 꺼짐" / 일부 꺼짐 "오전 9:00 · 일부 계약 알림 꺼짐" / 계약 알림 모두 꺼짐 "오전 9:00 · 결제 알림만 사용 중" / 전체 끔 "알림이 꺼져 있어요". 계약별 설정은 요약에 넣지 않는다.
- 카드 한 개(종 아이콘 · 알림 설정 · 요약 · [설정 변경 >]). 종류별 시점·알림 받는 시간·계약별 설정·"기한은 계약서나 입력한 계약 정보 기준" 설명은 설정 화면에서만. 캘린더 안내는 구분선과 간격으로 분리.

### 총액(aggregate) ≠ 실제 지급 (개정 18)
- 문제: 주택 월세 샘플 10/20 캘린더에 "38,000,000원 · 지출 합계 제외"(보증금 20,000,000 + 잔금 18,000,000). DB에 보증금 총액·계약금·잔금이 모두 확정 결제로 저장돼 있었고(날짜 없는 총액은 계약 시작일 10/20으로 채워짐), 캘린더는 같은 날 중립 금액을 그대로 합쳤다 → 화면 합산 문제가 아니라 저장된 데이터의 이중 계산.
  기존 서버 안전장치(개정 14 이후)는 총액과 몫의 방향(direction)이 같을 때만 동작해, 모델이 방향을 다르게 답하면 통과했다. 사용자 계약이 안전장치 배포 전에 분석됐을 가능성도 있다(확인 불가).
- 규칙 한 곳: `supabase/functions/_shared/paymentAggregate.ts` `findAggregateTotals` — 일회성·확정 금액 중 몫 이름(계약금·중도금·잔금·착수금·선금…, "계약금액"은 제외)이 아닌 금액이 몫(2개 이상)의 합과 정확히 같으면 합계. 방향은 보지 않는다. 애매하면 건드리지 않는다.
- 적용: ① 서버 분석(extraction.ts) → references(total) ② 앱 확인 화면(toReviewModel) — 이전 서버 결과도 ③ 저장된 계약을 읽을 때(rowMapping.toRecord, 앱·서버 알림 공용) 총액 행을 참고 금액(informational)으로 ④ migration `20261014000001_aggregate_payments.sql` — 같은 규칙으로 obligation만 informational로 바꾸고(행·금액 유지), 보증금 총액이 계약 정보에 없으면 deposit_amount를 채운다.
- 참고 금액(informational)은 캘린더·지출·알림에서 빠지고, "추가로 발생할 수 있는 비용"에도 넣지 않는다. 핵심 정보에 보증금·계약 총액과 같은 금액이면 생략, 아니면 "총액 — 계약금·잔금 등으로 나눠 지급" 참고 행.
- 테스트: `aggregate-payments.test.ts` (A 구성 합 20M·별도 20M 결제 없음, B 10/20 18,000,000 · 지출 합계 제외, C 월세·관리비 950,000 결제 예정과 분리, D 용역 3M+3M+4M·매매, 원인 재현 38M).

### 사진 계약서 민감정보 보호 — CLOVA OCR (개정 19)
- **흐름**: 사진(JPG·PNG, HEIC는 prepareFile에서 JPEG) 원본 비공개 저장 → `protect-document` → CLOVA OCR(1차) → 공통 형식(OcrPage) → 기존 탐지기(sensitive.ts) → 위치 연결 → 보호본(실제 픽셀을 덮은 새 JPEG) → 확인 → `document_derivatives`(protected_view, `{id}.protected_view.jpg`) → 앱은 보호본을 기본으로 표시. 원본은 바꾸지 않는다(테스트 L: 해시 동일).
- **개인정보 처리 흐름**: 사진 계약서 자동 보호를 위해 **원본 이미지를 OCR 공급자 CLOVA OCR(네이버클라우드)로 전송**한다. OCR 결과(전체 텍스트·원본 응답)는 Edge Function 메모리에서만 쓰고 DB·로그에 저장하지 않는다. 저장은 위치(0~1 bbox)·종류·가린 표시값(예: 800101-1******)·문맥 이름뿐. 개인정보처리방침·동의 문구 반영은 출시 전 할 일(LAUNCH_CHECKLIST).
  PDF는 지금처럼 외부 전송 없이 처리한다. 비밀값 `CLOVA_OCR_URL`·`CLOVA_OCR_SECRET`은 Edge Function secrets에만 (앱에 넣지 않음).
- **구조 (재사용 — 향후 스캔 PDF는 페이지 이미지 → 같은 OCR → 같은 탐지기 → 같은 가리기)**:
  `ocrProvider.ts`(OcrProvider 인터페이스 + ClovaOcr: 20초 시간 초과, 오류 구분 auth·rate_limited·timeout·server·bad_request·invalid_response·network, 일시적 오류만 1번 재시도) ·
  `ocrText.ts`(공급자 응답 → OcrPage, 좌표 0~1, 붙어 있는 숫자·하이픈 조각 합치기 — "1234-" "5678-" … → 한 값, 가릴 상자는 조각 전체) ·
  `sensitive.ts`(기존 탐지기 + OCR 필드명 오타 한 글자 허용 — "주민동록번호". 값 모양 검증을 통과한 값에만 쓰고, 제외 필드명(계약번호 등)이 우선) ·
  `imageRedact.ts`(해석 → 가로 1600px로 면적 평균 축소 → 불투명 검정 상자 → JPEG 85로 새로 저장 → 다시 해석해 상자 안이 모두 어두운지 확인) · `protectImage.ts`(판정).
- **가리기**: 단어 단위 좌표만 있으므로 부분 가리기 없이 값 상자 전체를 덮는다(여유: 좌우 글자 높이의 35%, 상하 20%). 상자는 줄인 뒤의 좌표에 칠한다 → 상자 안에 원본 픽셀 없음.
- **상태**: protected = OCR 성공 · 모든 가림 영역 칠함 · 보호본 생성 · 보호본 해석 성공 · 덮임 확인 · (가린 값이 있으면) 재-OCR 검증 통과가 모두 맞을 때만. no_sensitive_data = 정상적으로 읽었지만 찾지 못함(재-OCR 안 함). unreadable = 글자 40자 미만 · 평균 신뢰도 0.6 미만 · 신뢰도 0.8 미만 조각이 절반 초과 (migration `20261015000001`). failed = 그 밖(사유 코드만). EXIF 회전이 남은 JPEG는 좌표가 어긋날 수 있어 failed.
- **재-OCR 검증**: 가린 값이 있는 사진만 보호본을 다시 OCR. 실패 = 가린 값 전체(숫자만 비교, 이메일은 글자)가 한 덩어리 안에 다시 읽힘 · 칠한 상자 안에서 숫자 3개 이상인 조각이 읽힘. 숫자 조각(예: 1111)이 다른 곳에 있는 것만으로는 실패하지 않는다.
- **가리기 해제·다시 가리기**: 이미 보호된 사진이면 OCR을 다시 하지 않고 저장된 위치로 다시 그린 뒤 해석·덮임만 확인(`redrawImage`). OCR 호출: 처음 1회(+가린 값 있으면 검증 1회), 해제·다시 가리기는 0회.
- **여러 장**: 사진 한 장 = 문서 한 건, 장별 상태. 앱은 동시에 2장씩 처리(로컬 Edge 측정: 3장 동시는 자원 한도 초과가 있었고 2장은 없었음), 요청 실패 시 1번만 다시. 전체 상태는 모든 장이 protected·no_sensitive_data일 때만 완료, 아니면 "일부 페이지의 민감정보 보호를 완료하지 못했어요".
- **성능 (로컬 Edge Runtime, 가짜 OCR 지연 0.4초)**: 2400×3391 사진 한 장 — 해석 0.13~0.2초(WASM) · 축소·가리기·저장 0.3~0.45초 · 확인 0.06~0.13초. 순수 JS 해석(0.6~1.1초)일 때는 CPU 한도 초과가 잦아 WASM 해석으로 바꿨다. 실제 배포 측정: `scripts/protect-bench.mjs`.
- **보호본 해상도**: 원본 2400px 보존, 보호본 가로 1600px. 가독성 fixture(`smallprint.jpg`, A4 사진 기준 6·8·10pt 상당)에서 6pt도 1600px에서 읽을 수 있음을 눈으로 확인(테스트가 결과 이미지를 저장할 수 있음: `PHOTO_READABILITY_OUT`).
- **AI 분석과 독립**: 보호 상태(protection_status)와 문서 역할(document_role)·분석 결과는 따로 관리한다(보호 실패여도 분석은 진행 가능).
- **테스트**: `photo-protection.test.ts`(A~I·K·L·N·가리기 해제·EXIF·가독성, 가짜 OCR이 실제로 픽셀을 읽어 덮인 글자는 못 읽음), `photo-protection-copy.test.ts`(문구·J·동시 처리), `step14-photo-protection`(로컬 Edge + 가짜 CLOVA 서버: A~D·H·N·M·가리기 해제), fixture는 `scripts/fixtures/make-photo-fixtures.py`(모든 값 가짜).
- **실제 배포 측정 (2026-10-09, Supabase + 실제 CLOVA, fixture lease-a4.jpg 2400×3391 가짜 값, 동시 2장)**: 1장·5장·10장 모두 protected(16/16, 자원 한도 초과·시간 초과 0).
  서버 한 장 평균 약 3.4~3.8초 = CLOVA 1차 1.5~1.8초 + 재-OCR 1.3~1.5초 + 해석 0.16초 + 축소·가리기·저장 0.27초 + 확인 0.07초 → 시간 대부분은 CLOVA 응답. 10장 전체 약 19초. 첫 요청은 함수 시작 시간 때문에 앱에서 약 7초.
  동시 3장으로 10장 2회 측정: 20/20 protected, 전체 약 18.9~19.5초 — 동시 2장(약 19.1초)과 차이 없음(시간 대부분이 CLOVA 응답). 앱은 동시 2장 유지.

### 스캔 PDF 민감정보 보호 — 페이지 이미지 OCR (개정 20)
- **페이지 분류** (`scanPdf.ts` `classifyPage`): 보이는 글자 10개 이상 → 텍스트 페이지(기존 방식). 보이는 글자가 거의 없고 이미지가 있으면,
  **이미지 한 장이 보이는 영역(CropBox)의 85% 이상을 축에 맞게(0·90·180·270도·뒤집기) 덮을 때만 스캔 페이지**(dominant image, CTM 기준).
  작은 로고·서명 이미지가 있는 일반 텍스트 페이지는 글자가 많으므로 텍스트 페이지로 남는다(이미지 속 내용은 기존처럼 "확인하지 못함" 안내).
  글자도 이미지도 없는 페이지: 칠하는 연산이 많으면 윤곽선 글자(읽을 수 없음 → unsupported_scan `no_text`), 아니면 빈 페이지.
- **V1 지원 형식**: JPEG(DCTDecode) 회색·RGB 8비트, Flate 8비트 회색·RGB(PNG 예측자 10~15 포함, 해석은 fast-png가 이미 쓰는 pako `inflate`). 압축 데이터를 글자로 한 번 감싼 경우(`[ASCII85Decode FlateDecode]`·`[ASCIIHexDecode DCTDecode]` 등, reportlab 등이 기본으로 만듦)도 같은 형식으로 본다 — 실제 사용자 테스트 PDF가 이 형식이라 미지원으로 막혔던 것을 고침.
  **unsupported_scan**: CCITT·JBIG2·JPEG2000·CMYK·특수 색공간(Indexed 등)·마스크·1비트 (`scan_format`), 여러 이미지로 나뉜 페이지·작은(85% 미만) 이미지·기울어진 이미지·인라인 이미지 (`scan_layout`), 2500만 화소 초과 (`scan_too_large`).
  특수 페이지가 하나라도 있으면 **OCR 없이** 바로 중단(비용 없음).
- **구조 — 별도 worker** (`protect-scan-page`): `protect-document`는 PDF 분석·분류·조정·재조합·최종 검증, worker는 스캔 페이지 1장(이미지 해석 → 화면 방향으로 바로 세움 → CLOVA OCR → 탐지 → 실제 픽셀 덮기(1600px) → 덮임 확인 → 재-OCR 검증).
  - 인증: worker는 `Authorization: Bearer <service_role 키>`만 받는다(함수 안에서 비교, `verify_jwt=false`). 앱에는 이 키가 없으므로 사용자 토큰·anon 키로는 401(통합 테스트로 확인).
  - worker는 DB·저장소에 접근하지 않고 받은 이미지 스트림만 처리(요청: 길이 + JSON(쪽 번호·형식·방향·이 쪽의 가림 상태) + 이미지 바이트, 응답: 상태·영역(바로 선 이미지 0~1)·보호 JPEG). 원본 PDF 전체를 보내지 않는다.
  - 페이지마다 따로 호출되므로 CPU·메모리 한도가 페이지 단위. 동시 2장(`SCAN_CONCURRENCY`), worker 5xx·네트워크 오류는 1번만 다시. 하나라도 실패·읽지 못함·미지원이면 남은 페이지는 처리하지 않는다(`skipped`).
  - 한 문서의 스캔 페이지 최대 **`MAX_SCAN_PAGES = 20`**(protect.ts, 앱 문구 protectionCopy.ts) — 넘으면 unsupported_scan `too_many_scan_pages`("20쪽 이하로 나눠서 올려주세요"). 실제 측정 후 조정.
- **좌표** (`scanGeometry.ts`): CLOVA 상자(바로 선 이미지 0~1) → 저장된 이미지 좌표(회전·뒤집기 역변환) → PDF 이미지 단위 공간(y 뒤집기) → CTM → 페이지 기본 좌표 → 회전 전 MediaBox 기준 0~1(텍스트 페이지 영역과 같은 기준, DB `bbox_json`).
  OCR은 사람이 보는 방향(CTM + /Rotate)으로 돌린 이미지에 한다. 회전이 없는 JPEG(긴 변 3600 이하)는 원본 바이트를 그대로 OCR에 보내고, 그 밖은 바로 세워 긴 변 2400 이하 JPEG로 다시 저장해 보낸다.
- **보호본 재조합** (`assembleProtectedPdf`): 텍스트 페이지 = 기존 방식으로 글자를 제거·검증한 문서에서 복사. **스캔 페이지 = 원본 페이지를 복사하지 않고, 가린 이미지 한 장으로 새 페이지**(같은 MediaBox·CropBox·/Rotate·순서, 원래 이미지 자리에 같은 방향으로)
  → 숨은 OCR 글자층·원본 이미지·주석·링크가 남지 않는다(V1: 스캔 페이지의 링크·주석은 보호본에서 빠짐). 민감정보가 없는 스캔 페이지도 문서가 protected이면 같은 방식으로 새로 만든다.
- **검증**: 페이지별(덮임 확인 + 가린 값이 있으면 재-OCR) + 최종(보호본의 쪽수·MediaBox·회전이 원본과 같음 · pdf.js로 스캔 페이지에서 글자 조각 0개 · 텍스트 페이지에 놓친 Level 1 없음).
  숨은 OCR 글자층에서 찾은 Level 1 값 위치(값은 쓰지 않고 위치만)가 OCR 영역과 맞지 않으면(OCR이 놓쳤을 수 있음) failed `ocr_layer_mismatch`.
- **문서 상태 규칙**: 특수 페이지 → unsupported_scan(처리 전 중단) / 처리 중에는 우선순위 failed → unsupported_scan(worker가 알아낸 형식 문제) → unreadable / 모든 페이지 no_sensitive_data → no_sensitive_data / protected·no_sensitive_data 섞임 → protected.
  unreadable·failed·unsupported_scan이 하나라도 있으면 보호 PDF 파생본을 만들지 않는다(기존 파생본도 지움).
- **페이지별 상태** (migration `20261016000001`): `contract_documents.protection_pages` jsonb — `[{"page":1,"kind":"text","status":"protected","detail":null},{"page":2,"kind":"scan","status":"no_sensitive_data","detail":null}]`. 원문·OCR 텍스트·민감값 없음. 사용자가 바꿀 수 없음(보호 상태 보호 함수에 추가). 스캔 페이지 영역은 `source='ocr'`.
- **가리기 해제·다시 가리기**: 이미 protected인 문서는 스캔 페이지를 저장된 위치로 다시 그린다(OCR 0회, 페이지 좌표 → 바로 선 이미지 좌표로 되돌려 칠함). 텍스트 페이지는 원본에서 다시(외부 호출 없음).
- **앱 문구**: 예전 "스캔된 페이지가 포함되어 있어 자동 가리기를 지원하지 않아요."는 삭제. 특수 형식 → "자동 가리기를 지원하지 않는 형식의 페이지가 있어요"(+ 쪽 번호), 20쪽 초과 → 나눠서 올리라는 안내, 읽지 못함·실패는 문제 페이지 번호를 함께. 예전 버전에서 미지원 처리된 스캔 PDF(`scanned_pages`)는 다시 보호할 수 있다.
- **테스트**: `tests/protection/scan.test.ts`(좌표 왕복·픽셀 회전 / 회전 0·CTM 90·180·270·/Rotate 90·180·270·여백·CTM 축소+이동·CTM+Rotate+원점 이동 — poppler로 원본·보호본을 실제로 그려 주민번호 자리가 검고 계약번호는 그대로인지 확인 / Flate 4종 / 미지원 7종·레이아웃 3종 / 로고 있는 텍스트 PDF / 20쪽 초과 / 혼합 A~D / 숨은 글자층 위치 불일치 / 상태 규칙 / 가림 바꾸기 OCR 0회 / 1600px),
  `step15-scan-pdf-protection`(로컬 Edge + worker + 가짜 CLOVA: 숨은 글자층 제거·혼합·CCITT·OCR 오류·worker 직접 호출 401). 좌표 코드를 일부러 틀리게 바꾸면 회전 테스트가 실패하는 것을 확인함.
- **로컬 측정 (Edge Runtime, 가짜 OCR 지연 0.6초, lease-a4 2400×3391 페이지)**: 1·5·10·20쪽 모두 protected, 페이지당 OCR 2회. 전체 약 3.4·13·17·32초.
  worker 한 장: 해석 0.15초 · 축소·가리기·저장 0.3~0.36초 · 확인 0.07초. 보호본 크기 약 60%(원본 PDF 10.0MB → 5.9MB, 20쪽). 5쪽 측정 중 1번, 같은 worker에 동시 요청 2개가 겹쳐 CPU hard limit → 1번 다시 시도로 복구.
  실제 배포 측정: `BENCH_MODE=scan-pdf node scripts/protect-bench.mjs`.
- **실제 배포 측정 (2026-10-09, Supabase + 실제 CLOVA, lease-a4 2400×3391 가짜 값 페이지, 동시 2장)**: 1·5·10·20쪽 모두 protected (36/36쪽, HTTP 200, 자원 한도·시간 초과 응답 0).
  전체 8.5초(1쪽, 함수 시작 시간 포함) · 12.5초(5쪽) · 21.5초(10쪽) · 44.1초(20쪽) → 첫 요청 뒤에는 쪽당 약 2.2초.
  한 쪽: CLOVA 1차 평균 1.5~1.8초(최대 3.0) + 재-OCR 1.3~1.6초(최대 3.5) + 해석 0.13~0.16초 + 가리기·저장 0.22~0.29초 + 확인 0.07초 → 시간 대부분은 CLOVA 응답.
  OCR 호출 쪽당 2회(20쪽 = 40회). 크기: 원본 PDF 대비 약 60%(20쪽 10.0MB → 5.9MB), 보호 이미지 1600×2261 약 0.3MB/쪽.
  → `MAX_SCAN_PAGES = 20` 유지 (20쪽 약 44초).

### 앱 내 계약서 뷰어 (개정 21)
- **왜**: 예전에는 Signed URL을 휴대폰 브라우저(Chrome)로 넘겨, 세로 PDF가 화면 폭에 맞지 않고 오른쪽이 잘렸다(화면 맞춤을 앱이 정할 수 없음).
- **구조**: `openDocument.ts` → (원본은 `requireReveal()` 확인 후) Signed URL(2분)을 메모리에만 두고(`features/viewer/session.ts`, 라우트 주소에 넣지 않음) → `app/viewer.tsx` → `DocumentViewer`(react-native-webview).
  WebView HTML(`viewerHtml.ts`)은 앱에 포함된 pdf.js 번들(`viewerScript.generated.js`, `scripts/vendor-viewer.mjs`)을 인라인으로 실행한다. 웹 버전은 지금처럼 새 탭.
- **화면**: 첫 화면은 페이지 폭 = 화면 폭(축소, 자르지 않음), 원본 비율·/Rotate 그대로, 여러 쪽은 세로로 이어서, 두 손가락 확대(최대 5배)·확대 후 상하좌우 이동(WebView 기본 확대).
  확대가 끝나면 보이는 쪽만 그 배율로 다시 그려 선명하게(최대 4배, 한 쪽 캔버스 1,200만 화소 이하). 사진(JPG·PNG)도 같은 화면에서 폭 맞춤. 근거 위치가 있으면 그 쪽으로 이동.
- **메모리**: 쪽 크기만 먼저 읽어 자리를 잡고, 화면 근처(위아래 1.5화면) 쪽만 한 번에 한 쪽씩 그리며, 멀어진 쪽은 캔버스를 비운다. 20쪽 스캔(10MB) 측정: 동시에 남는 캔버스 최대 5~6장(약 33~39MB), 첫 쪽 약 0.1초(Chromium).
- **보안**: CSP — 네트워크는 문서 Signed URL의 출처 한 곳만(`connect-src`), 스크립트는 인라인·blob worker·wasm만, 외부 스크립트·폰트·이미지 없음. pdf.js·CMap·wasm은 앱에 포함(CDN 없음).
  WebView는 가상 주소(`https://viewer.pacto.invalid/`) 외 이동·새 창·파일 접근을 막고, `incognito`(캐시·쿠키 안 남김). 문서 내용은 기기 안에서만 그리며 외부로 보내지 않는다.
  WebView 콘솔 로그는 앱으로 넘기지 않고, 뷰어는 상태 코드·쪽수만 앱에 알린다. 기존 접근 권한(본인 문서 · 비공개 저장소 · 짧은 Signed URL)은 그대로.
  Supabase Storage Signed URL은 `Access-Control-Allow-Origin: *`라 WebView에서 바로 받을 수 있다(로컬 Supabase로 확인. 배포 환경은 기기 확인 필요).
- **테스트**: `npm run test:viewer` (Playwright Chromium, 휴대폰 390×844·배율 2.75): 세로·가로·스캔·/Rotate 90·180·보호본·원본·JPG·PNG 첫 화면 폭 맞춤·가로 넘침 없음·비율, 여러 쪽 세로 순서, 근거 쪽 이동, 핀치 2.5배 확대 후 고해상도 다시 그림·이동, 20쪽 스캔 메모리, 외부 요청 차단, 오류 코드.
- **진단 모드·안전장치 (개정 21-1, 실기기 크래시 조사)**: preview APK(`EXPO_PUBLIC_VIEWER_DIAGNOSTICS=true`)·개발 빌드에서 MY → "계약서 뷰어 진단".
  1 화면만(WebView 없음) · 2 빈 WebView · 3 pdf.js 초기화만 · 4 앱에 포함된 1쪽 PDF(`samplePdf.ts`) · 5 실제 보호본 PDF.
  단계 기록(`viewer_route`·`webview_mounting`·`webview_mounted`·`pdfjs_loaded`·`pdf_fetch_started`·`pdf_loaded`·`first_page_render_started`·`first_page_rendered`·`error(코드)`)은
  기기 안 파일에 동기식으로 바로 써서(expo-file-system) 앱이 종료돼도 다음 실행 때 보인다. 기록은 시각·모드·단계·코드만 (주소·토큰·내용·오류 메시지 없음).
  react-native-webview는 불러오는 순간 네이티브 모듈을 찾고 없으면 오류를 던지므로 화면에 붙일 때 lazy로 불러오고, 실패·렌더 오류는 Error Boundary,
  뷰어가 열려 있는 동안의 JS 오류는 전역 처리기로 잡아 앱을 종료하지 않고 오류 화면("계약서를 불러오지 못했어요. 잠시 후 다시 시도해주세요.")을 보여준다.
  사진(JPG·PNG)은 pdf.js 없이 이미지 한 장 HTML. 문서마다 mime_type(없으면 확장자)으로 PDF/사진을 나눈다. Signed URL이 없거나 https가 아니면 뷰어를 열지 않는다.
- **실기기 크래시 원인 (개정 21-2, Galaxy S26 · Android 16 · One UI 8.5)**: 진단 기록 `viewer_route → webview_mounting` 뒤 종료, 안드로이드 종료 기록
  `java.lang.ClassCastException: java.lang.String cannot be cast to [ReadableArray]` at `RNCWebViewManagerDelegate.setProperty` ← `ViewManager.createViewInstance` ← Fabric `preallocateView`.
  원인: `dataDetectorTypes="none"`(글자). 네이티브 정의는 목록(`ReadonlyArray`)이고, iOS 쪽 JS는 글자를 목록으로 바꾸지만 Android 쪽은 그대로 넘겨 WebView를 만드는 순간 종료.
  수정: `['none']`(목록). 고정 설정은 `VIEWER_WEBVIEW_PROPS` 한 곳에 두고, 테스트(`webview-props.test.ts`)가 react-native-webview 네이티브 정의와 값 형식(목록·참거짓·글자·숫자)을 대조한다.

### 암호 PDF (개정 22)
- **원칙**: 사용자가 비밀번호를 아는 경우에만 연다. 비밀번호 추측·우회·크랙은 하지 않는다.
- **판별** (`_shared/protection/pdfDecrypt.ts`): 트레일러 `/Encrypt`만 본다 (pdf-lib, 내용은 읽지 않음). 표준 보안 방식(Standard, R2~R6)이 아니면 `unsupported_encryption`.
- **복호화**: qpdf 12.2.0(WASM, `@neslinesli93/qpdf-wasm@0.3.0`)을 요청마다 새 인스턴스로 띄워 **emscripten 메모리 파일 시스템(RAM)** 안에서만 연다. 끝나면 파일을 지우고 인스턴스를 버린다. 복호화 PDF는 저장소·DB·임시 파일·로그에 남기지 않는다.
  - 먼저 비밀번호 없이 시도 → 소유자 비밀번호만 걸린 문서는 묻지 않고 연다 (`accessible`).
  - qpdf 메시지는 번들에서 콘솔 대신 지역 배열로만 받아 판정에만 쓴다 (`invalid password` → 비밀번호 필요/틀림).
- **원본**: 암호 상태 그대로 보관 (덮어쓰지 않음). `contract_documents.access_status` = `accessible` | `password_required` | `unsupported_encryption`. "비밀번호 틀림"은 저장하지 않는 한 번의 응답(`invalid_password`).
- **보호본**: 복호화 사본 → 기존 보호 파이프라인(텍스트·스캔 페이지) → 민감정보를 지운 **암호 없는** 보호본 저장 → 비밀번호 없이 열람.
- **AI 분석** (`analyze-contract`): 암호 PDF는 원본을 보내지 않는다.
  - `protected` → 보호본 / `no_sensitive_data` → 요청 body의 비밀번호로 서버 메모리 복호화 사본 (보호본이 없으므로)
  - `failed`·`unreadable`·`unsupported_scan`·지원하지 않는 암호·처리 전 → AI를 부르지 않고 `protection_required`(422). 앱이 먼저 안내.
  - 암호 없는 문서는 기존과 같다 (원본).
- **비밀번호**: 앱 등록 화면 메모리(`useRegistration.passwords`)에만 → `protect-document`·`analyze-contract` **POST body**로만. 주소·DB·AsyncStorage·SecureStore·로그·분석 도구에 넣지 않는다. 분석 완료·취소·화면 종료 시 지운다.
- **원본 보기**: `requireReveal()` → 기기 안 뷰어(pdf.js)가 비밀번호를 요청 → 앱이 입력받아 WebView로만 전달 (서버로 보내지 않음, 기억하지 않음). 보호본은 비밀번호 없이.
- **민감정보가 없는 암호 PDF**: 보호본(=복호화 사본)을 저장하지 않으므로 계약서를 볼 때마다 원본 비밀번호가 필요하다.
- **정확도 비교**: `scripts/encrypted-bench.ts` (배포 환경·실제 AI, 같은 가짜 계약서를 일반 PDF / 암호 PDF→보호본으로 분석해 값 비교).
