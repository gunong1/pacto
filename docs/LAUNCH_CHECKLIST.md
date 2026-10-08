# 정식 출시 전 체크리스트

개발·테스트 중에 켜 둔 설정 중 **정식 출시 전에 반드시 끄거나 바꿔야 하는 것**을 모아 둡니다.
새 항목이 생기면 여기에 추가합니다.

## 꺼야 하는 것

- [ ] **테스트 알림 서버 설정 끄기** — `ALLOW_TEST_PUSH`
  - 켠 날: 2026-10-08 (푸시 알림 테스트용)
  - 왜: 켜져 있으면 로그인한 사용자가 자기 기기로 테스트 알림을 보낼 수 있다 (남용·스팸 가능)
  - 끄는 법 (프로젝트 폴더 PowerShell):
    ```
    npx supabase secrets unset ALLOW_TEST_PUSH
    ```
  - 확인: 앱에서 테스트 알림을 누르면 "서버에서 테스트 알림이 꺼져 있어요"가 나오면 꺼진 것
- [ ] **스토어용 빌드는 `production` 프로필로** — `preview` 프로필은 테스트 알림 버튼(`EXPO_PUBLIC_SHOW_PUSH_TEST=true`)이 보인다
  ```
  npx eas-cli@latest build --profile production
  ```
