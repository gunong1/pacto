# PACTO (팩토)

> 내 모든 계약이 모이는 곳.
> "계약서를 넣어두세요. 중요한 순간은 PACTO가 기억합니다."

개인용 계약 지갑 앱 — 계약서 보관, 계약정보 자동정리, 일정·지출·종료/갱신/해지 통보기한 관리.
설계 문서: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 현재 상태: Step 1~8

- Expo SDK 57 · Expo Router · TypeScript(strict) · TanStack Query · Zustand · React Hook Form + Zod
- **Supabase**: PostgreSQL + RLS(본인 데이터만), 이메일·Apple·Google 인증, private Storage(원본 계약서, Signed URL 열람)
- AI는 아직 **MockAIProvider** (실제 모델은 원본 보관 흐름 확정 후 추출 정확도 비교로 선정)
- `.env`에 Supabase 값이 없으면 예시 데이터(mock)로 동작 — 설정 방법: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)

## 실행

```bash
npm install
cp .env.example .env    # (선택) Supabase 연결
npx expo start          # Expo Go 앱으로 QR 스캔 (iOS/Android)
npm run web             # 웹 미리보기 (http://localhost:8081)
```

## 검증

```bash
npm run check             # typecheck + lint + unit tests
npm run db:start          # 로컬 Supabase (Docker)
npm run db:test           # RLS 교차 접근 테스트 (pgTAP)
npm run test:integration  # 인증 / 계약 CRUD / 원본 보관 통합 테스트

# 웹 미리보기 E2E (playwright 필요)
node e2e/web-flow.js                                   # mock 모드: Step 4 흐름
node e2e/quick-entry.js                                # mock 모드: 직접 입력(빠른 입력) 30초 등록
BASE_URL=http://localhost:8082 node e2e/auth-flow.js   # 실제 모드: 가입·로그인·탈퇴
BASE_URL=http://localhost:8082 node e2e/supabase-flow.js  # 실제 모드: 계약 CRUD·재실행 유지
BASE_URL=http://localhost:8082 node e2e/wallet-flow.js    # 실제 모드: 가입→PDF 등록→재실행→원본 열람
```
(실제 모드 웹 미리보기: `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`를 로컬 값으로 두고 `npx expo start --web --port 8082`)

## 구조

```
src/app/          라우트 (Expo Router) — 홈/계약/(+)/캘린더/MY 탭, 계약 상세, 등록 모달
src/domain/       순수 TS 계산 로직 (D-Day, 상태, 해지 통보기한, 결제 전개, 지출, 알림 규칙)
src/data/         저장소·원본 보관소·AI 인터페이스 + mock / Supabase 구현 (src/data/index.ts에서 선택)
supabase/         migrations(스키마·RLS·Storage), tests(pgTAP), functions(delete-account)
src/features/     화면용 훅, 폼 스키마, 등록 위저드 상태
src/components/   디자인 시스템 (ui/) + PACTO 컴포넌트 (pacto/)
src/theme/        디자인 토큰
```
