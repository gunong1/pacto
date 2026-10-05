# PACTO (팩토)

> 내 모든 계약이 모이는 곳.
> "계약서를 넣어두세요. 중요한 순간은 PACTO가 기억합니다."

개인용 계약 지갑 앱 — 계약서 보관, 계약정보 자동정리, 일정·지출·종료/갱신/해지 통보기한 관리.
설계 문서: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 현재 상태: Step 1~4 (Mock Data)

- Expo SDK 57 · Expo Router · TypeScript(strict) · TanStack Query · Zustand · React Hook Form + Zod
- 데이터는 **인메모리 mock 저장소** (앱을 다시 시작하면 초기 mock으로 돌아감)
- AI는 **MockAIProvider** (어떤 파일을 넣어도 "공기청정기 렌탈" 계약을 추출한 것처럼 응답)
- 로그인은 mock (Apple/Google/이메일 버튼 모두 바로 진입)
- **미연결**: Supabase, 실제 AI, 파일 업로드(Storage), Push Notification → Step 5 이후

## 실행

```bash
npm install
npx expo start          # Expo Go 앱으로 QR 스캔 (iOS/Android)
npm run web             # 웹 미리보기 (http://localhost:8081)
```

## 검증

```bash
npm run check           # typecheck + lint + unit tests
node e2e/web-flow.js    # 웹 미리보기 실행 중일 때, Step 4 필수 흐름 10단계 E2E
```

E2E가 확인하는 흐름: 앱 실행 → 홈 → 계약 목록 → 계약 상세 → 계약 등록(PDF) → AI mock 결과 확인/수정 → 저장 → 홈/목록 반영 → 캘린더 반영 → 월 지출 반영

## 구조

```
src/app/          라우트 (Expo Router) — 홈/계약/(+)/캘린더/MY 탭, 계약 상세, 등록 모달
src/domain/       순수 TS 계산 로직 (D-Day, 상태, 해지 통보기한, 결제 전개, 지출, 알림 규칙)
src/data/         저장소/AI 인터페이스 + mock 구현 (src/data/index.ts에서 구현체 교체)
src/features/     화면용 훅, 폼 스키마, 등록 위저드 상태
src/components/   디자인 시스템 (ui/) + PACTO 컴포넌트 (pacto/)
src/theme/        디자인 토큰
```
