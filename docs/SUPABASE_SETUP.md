# Supabase 연결 가이드 (클라우드 프로젝트)

PACTO 저장소에는 DB 스키마·보안 정책·Edge Function이 모두 코드로 들어 있습니다.
아래 순서대로 실행하면 실제 서비스용 Supabase 프로젝트가 같은 구조로 만들어집니다.
(이 가이드의 대시보드 메뉴 이름은 2026-10 기준 기억에 의존한 부분이 있어 실제 화면과 다를 수 있습니다.)

## 1. 프로젝트 생성
1. https://supabase.com → New project
2. **Region: Northeast Asia (Seoul)** — `ap-northeast-2`
3. 데이터베이스 비밀번호는 안전한 곳에 보관

## 2. 스키마·보안·스토리지 적용 (PC 터미널, pacto 폴더에서)
```bash
npx supabase login
npx supabase link --project-ref <프로젝트 ref>     # 대시보드 URL의 project/<ref>
npx supabase db push                               # 테이블, RLS, save_contract, private 버킷, Storage 정책
npx supabase functions deploy delete-account       # 회원 탈퇴 (Storage 파일 + 계정 삭제)
npx supabase functions deploy analyze-contract     # 계약서 자동 정리 (2-1 참고)
```
- `contract-files` 버킷은 **private**로 생성됩니다. 대시보드에서 public으로 바꾸지 마세요.
- service_role 키는 Edge Function에만 자동 주입됩니다. 앱이나 저장소에 넣지 마세요.

## 2-1. 계약서 자동 정리 (AI) 연결
API 키는 **Supabase secret에만** 저장합니다 (앱·저장소에 넣지 않음).
```bash
npx supabase secrets set AI_PROVIDER=openai OPENAI_API_KEY=sk-...        # 키는 본인 터미널에서만 입력
npx supabase secrets set OPENAI_MODEL=gpt-5.4-mini                       # (선택) 모델 변경 시
npx supabase functions deploy analyze-contract
```
- 요청에 `store: false`를 넣어 OpenAI 측 응답 저장을 끄도록 요청합니다. 학습 사용·보관 정책은 OpenAI 최신 정책을 확인하세요.
- 사용자가 '계약서 자동 정리 외부 처리'에 동의하지 않았다면 앱이 먼저 동의를 받습니다 (profiles.ai_processing_agreed_at).
- 실패 원인은 대시보드 Edge Functions → analyze-contract → Logs에서 오류 코드로만 확인할 수 있습니다 (계약서 내용은 기록하지 않음).
  - `provider_auth`: API 키 오류 · `provider_http_404`: 모델 이름 확인 · `provider_rate_limited`: 사용 한도

## 3. 인증 설정 (Authentication)
| 항목 | 값 |
|---|---|
| Site URL | `pacto://` |
| Redirect URLs | `pacto://**`, `exp://**` (Expo Go 개발용), `http://localhost:8081/**` (웹 미리보기) |
| Confirm email | 켜기 권장 (가입 후 메일 링크로 인증) |
| Minimum password length | 8 |
| SMTP | 실제 서비스 전 자체 SMTP 설정 권장 (기본 메일 발송은 시간당 한도가 낮음) |

### Apple / Google 로그인
- Google: Google Cloud Console에서 OAuth 클라이언트 생성 → Supabase Auth Providers → Google에 Client ID/Secret 입력
- Apple: Apple Developer에서 Services ID·Key 생성 → Supabase Auth Providers → Apple에 입력
- 공급자 설정 전에는 앱의 Apple/Google 버튼이 오류를 표시합니다 (이메일 로그인은 정상 동작).

## 4. 앱 연결
```bash
cp .env.example .env
# Project Settings → API 의 Project URL, anon(publishable) key 입력
npx expo start
```
`.env`가 비어 있으면 앱은 예시 데이터(mock)로 동작합니다.

## 로컬 개발 (Docker 필요)
```bash
npm run db:start          # 로컬 Supabase (DB, Auth, REST, Storage, Edge Runtime, Mailpit)
npm run db:test           # RLS 교차 접근 테스트 (pgTAP)
npm run test:integration  # 인증·계약 CRUD·원본 보관 통합 테스트
npm run db:types          # 스키마 변경 후 src/types/database.ts 재생성
```
로컬 메일함(가입/재설정 메일): http://127.0.0.1:54324
