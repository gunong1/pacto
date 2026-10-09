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

## 출시 전 반영해야 하는 것 — 사진 계약서 보호 (CLOVA OCR)

- [ ] **개인정보처리방침·동의 문구에 CLOVA OCR 반영** — 사진 계약서 자동 보호를 위해 원본 사진이 네이버클라우드 CLOVA OCR로 전송된다 (처리 위탁·국외 이전 여부 등은 확인 필요)
  - 지금은 AI 분석 동의 문구가 OpenAI만 언급한다. 사진 보호(OCR)는 동의 여부와 관계없이 실행된다 — 동의를 받을지, 동의 전에는 OCR을 하지 않을지 결정 필요
- [ ] **CLOVA 비밀값은 Supabase secrets에만** — `CLOVA_OCR_URL`, `CLOVA_OCR_SECRET` (앱·GitHub·채팅에 넣지 않기)
- [ ] **실제 배포 성능 측정 결과 확인 후 동시 처리 수 확정** — `scripts/protect-bench.mjs` (지금 앱은 2장씩)
- [x] **스캔 PDF: 실제 배포 측정 후 `MAX_SCAN_PAGES`(지금 20) 확정** — 2026-10-09 측정: 1·5·10·20쪽 모두 protected, 20쪽 약 44초 → 20 유지 — `BENCH_MODE=scan-pdf node scripts/protect-bench.mjs` (1·5·10·20쪽, CPU 한도 초과·시간 초과 여부). 바꾸면 서버 `protect.ts`와 앱 `protectionCopy.ts` 둘 다
  - 스캔 PDF도 페이지 이미지가 CLOVA OCR로 전송된다 — 위 개인정보처리방침·동의 결정에 포함
- [x] **`protect-scan-page` 함수 배포** — `npx supabase functions deploy protect-document protect-scan-page` (worker는 service_role 키로만 호출됨 — 별도 비밀값 없음)
