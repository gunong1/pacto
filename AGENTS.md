This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## 사용자에게 명령어를 안내할 때 (프로젝트 소유자 요청)

- 사용자는 Windows PowerShell에서 직접 명령어를 실행한다. 안내는 한국어로 한 단계씩.
- **모든 명령어마다 "이게 무슨 명령어인지"를 초등학생도 이해할 수 있게 한두 줄로 설명한다.** 비유를 써도 좋다.
  - 예: `git pull` — "인터넷에 있는 최신 코드를 내 컴퓨터로 가져와요. 휴대폰 앱 '업데이트' 버튼과 비슷해요."
- 바꿔 넣어야 하는 부분(경로·비밀값 등)은 그대로 붙여넣으면 안 된다고 분명히 적고, 무엇으로 바꾸는지 알려준다.
- 비밀값은 채팅·스크린샷에 올리지 말라고 안내한다.
- 정식 출시 전에 되돌려야 하는 설정은 `docs/LAUNCH_CHECKLIST.md`에 추가한다.
- 부품 설치 안내는 `npm install` 대신 **`npm ci`**를 쓴다. `npm install`은 사용자 PC(Windows)에서 `package-lock.json`을 바꿔, EAS 빌드(`npm ci`)가 "lock file not in sync"로 실패한 적이 있다 (2026-10-08).

## 분석 규칙이 복잡해지면 먼저 알린다 (프로젝트 소유자 요청, 2026-10-11)

2026-10 리팩터링으로 "계약 의미 판단은 서버 한 곳(`supabase/functions/_shared/analysisRules/`), 앱은 보여주고 사용자 수정만"으로 정리했다.
수정 작업 중 아래 신호가 보이면 **작업을 마친 뒤 보고할 때 "규칙이 복잡해지고 있다"고 사용자에게 분명히 말하고**, 무엇이 문제인지와 정리 방법을 짧게 제안한다 (정리 자체는 승인받고 진행).

- 같은 판단(금액 확정·총액·결제일·통보기한·주요 날짜 등)을 서버 밖(앱 화면·`extraction.ts`(앱)·`rowMapping.ts`·폼)에서 다시 하게 될 때
- 특정 단어 하나("특약", "포함" 같은)만 보고 결과를 바꾸는 규칙을 새로 넣을 때
- 한 계약서 사례를 고치려고 예외 규칙을 덧붙이거나, 같은 영역 규칙이 서로 덮어쓰는 순서에 의존하게 될 때
- 저장된 데이터를 읽을 때마다 보정하는 코드를 넣으려 할 때 (→ 일회성 마이그레이션으로)
- golden 테스트(`src/domain/__tests__/golden/`) 기대값을 이유 없이 바꿔야 통과할 때
- `analysisRules/` 파일 하나가 크게 불어나거나, 규칙 머리말(이름·목적·입력·출력·예시·테스트) 없이 규칙이 추가될 때
- 화면 파일이 다시 수백 줄 이상으로 커질 때 (예: `ContractForm.tsx`는 섹션을 `formSections/`로 분리해 둠)
