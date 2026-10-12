# 운영 배포 실행서 (2026-10-13 · 승인 전 — 아직 실행하지 않음)

기준: 운영 `migration list` 결과 (사용자 확인) — 연결 프로젝트 **pacto · yoftnocpaxkbqqajgfvl · Seoul**
- 적용됨: 20261025000002 · **20261026000001** 및 그 이전 전부 → **다시 실행하지 않음**
- 미적용: **20261026000002_old_client_guard** · **20261027000001_deposit_return_alerts** → 이 두 개만 적용

실행 위치: Windows PowerShell · `C:\Users\김지은\pacto\pacto` · Supabase CLI **2.119.0** (로컬 검증에 쓴 버전과 같음 — 배포가 끝날 때까지 CLI를 업데이트하지 마세요)

---

## 미적용 2개 — 의존성 · 데이터 영향 · 순서
| 순서 | 파일 | 하는 일 | 필요 조건 | 데이터 영향 | 되돌리기 |
|---|---|---|---|---|---|
| A | 20261026000002_old_client_guard | `save_contract` 함수 교체: 결제 id 없이 저장하는 아주 예전 앱이 금액 변경 이력·보증금 연결·성격 정보를 지우려 하면 저장 전체를 중단 | 20261026000001 (적용됨 — 같은 8인자 함수) | **없음** (함수만 교체) | `scripts/deploy/rollback/rollback-20261026000002.sql` + 이력 repair |
| B | 20261027000001_deposit_return_alerts | 알림 종류 `deposit_return`·저장 표시 `_v` 허용, 기준일 뒤 알림(음수) 허용, 묶음·반환 기록 변경 시 재계산 트리거, 예전 앱 설정 저장 시 새 종류 보존 트리거 | 20261026000001 (contract_funds·fund_refunds 테이블) | 기존 값 변경 없음 (검사 조건 교체 시 기존 행 검사만 — 기존 값은 모두 새 조건도 통과) | `rollback-20261027000001.sql` + 이력 repair (새로 생긴 키·음수 예약만 정리) |

A와 B는 서로 의존하지 않지만, 번호 순서(A → B)로 적용합니다. **둘 다 적용되기 전에는 새 APK를 배포하지 않습니다** (로컬 실험: B가 없으면 새 앱의 알림 설정 저장이 거부됨).

현재 운영 앱(이미 배포된 APK)에 대한 영향: A·B 모두 기존 앱 동작을 바꾸지 않습니다 (A는 결제 id를 보내지 않는 아주 예전 앱의 위험한 저장만 막음).

## 로컬 검증 결과 (이 실행서의 근거)
- 단계 적용: `stage.mjs` + `db push --workdir` 로 한 번에 **한 파일만** 적용되고 `schema_migrations` 이력이 함께 기록됨 (dry-run 목록 = 실제 적용 목록)
- 이력·스키마 대조(`check-schema.sql`): 단계마다 history = schema 확인. SQL Editor로 직접 실행한 경우 `history=false · schema=true` 로 잡히고 `migration repair --status applied` 로 일치시킨 뒤 다음 단계가 그 파일을 다시 실행하지 않음
- 실패 시: 파일 하나가 중간에 실패하면 그 파일 전체가 취소되고 이력도 남지 않음
- 되돌리기: B → A 순서로 되돌리고 `repair --status reverted` → 이력·스키마 모두 미적용 상태 → 다시 단계 적용 성공
- 업그레이드 리허설(예전 데이터 → 적용): 계약·결제 id·금액·방향·금액 변경 이력·보증금 묶음 연결·RLS·예전 앱 저장 5/5 통과
- 백업·복구: 로컬 데이터 덤프 → DB 초기화 → 복구 → 계약·결제 id·변경 이력·보증금 묶음·반환 기록·사용자 체크섬 일치, 복구된 사용자 로그인·조회 정상
- 한계: 운영 DB에서 직접 실행해 본 것은 아님 (운영 데이터 양·운영 CLI 연결 방식은 알 수 없음)

---

## 0단계 — 사전 확인 (읽기만)
1. 대시보드 → SQL Editor → `scripts/deploy/check-schema.sql` 내용 붙여넣고 실행
   - 기대: `20261025000002 t t` · `20261026000001 t t` · `20261026000002 f f` · `20261027000001 f f`
   - **중단 조건**: 한 줄이라도 다르면 진행하지 않고 결과를 공유
2. `npx supabase functions list` → 6개 함수의 현재 VERSION · UPDATED_AT 기록 (함수 되돌릴 때 기준)
3. 백업
   - 대시보드 → Database → Backups: 최근 자동 백업 시각 확인 (요금제에 따라 없을 수 있음 — 현재 요금제는 알 수 없음)
   - 수동 백업 (자동 백업 여부와 관계없이 권장):
     ```powershell
     npx supabase db dump --linked -f pacto-schema-before.sql
     npx supabase db dump --linked --data-only -f pacto-data-before.sql
     (Get-Item pacto-schema-before.sql, pacto-data-before.sql).Length
     (Select-String -Path pacto-data-before.sql -Pattern 'INSERT INTO "public"."contracts"', 'INSERT INTO "public"."contract_payments"', 'INSERT INTO "public"."contract_payment_changes"', 'INSERT INTO "auth"."users"').Count
     ```
   - 백업 판정: 두 파일 크기 > 0, 마지막 명령 결과가 3 이상 (계약·결제·사용자 데이터가 들어 있음. 금액 변경 이력·보증금 묶음·반환 기록은 운영에 그 데이터가 있을 때만 들어 있어 4가 될 수 있음)
   - 더 확실히 하려면 SQL Editor에서 `select count(*) from public.contracts; select count(*) from public.contract_payments;` 값을 적어 두고, 백업 파일의 해당 INSERT 묶음과 비교 (복구가 필요할 때 기준)
   - **포함되지 않는 것**: Storage에 올라간 계약서 파일(PDF·사진). 이번 마이그레이션은 Storage를 건드리지 않음
   - 백업 파일에는 사용자 계약 정보가 있습니다 → 이 PC에만 보관, 채팅·클라우드에 올리지 말고 배포 확인 후 삭제
   - **중단 조건**: 덤프 실패, 파일 크기 0, 카운트 3 미만

## 1단계 — 마이그레이션 A (20261026000002)
```powershell
node scripts/deploy/stage.mjs 20261026000002
npx supabase db push --workdir .deploy-stage --linked --dry-run
```
- **dry-run 판정**: 목록이 정확히 `20261026000002_old_client_guard.sql` 한 줄. 다른 파일이 보이거나 비어 있으면 **중단**
- 연결 오류(프로젝트를 찾을 수 없음)가 나면 같은 명령에 `--project-ref yoftnocpaxkbqqajgfvl` 를 붙여 다시 dry-run
```powershell
npx supabase db push --workdir .deploy-stage --linked
```
- 성공 판정 (모두 만족해야 다음 단계)
  1. 명령 출력에 `Applying migration 20261026000002_old_client_guard.sql...` 후 오류 없음
  2. `npx supabase migration list` → 20261026000002 의 Remote 칸 채워짐, 20261027000001 은 비어 있음
  3. SQL Editor `check-schema.sql` → `20261026000002 t t`, `20261027000001 f f`
  4. 현재 설치된 앱으로 기존 계약 하나 열어 수정·저장 → 저장 성공, 금액·일정 그대로
- **중단 조건**: 오류 출력, 이력·스키마 불일치, 기존 앱 저장 실패 → 다음 단계 진행하지 말고 결과 공유 (필요 시 되돌리기)

## 2단계 — 마이그레이션 B (20261027000001)
```powershell
node scripts/deploy/stage.mjs 20261027000001
npx supabase db push --workdir .deploy-stage --linked --dry-run     # 정확히 20261027000001 한 줄
npx supabase db push --workdir .deploy-stage --linked
```
- 성공 판정
  1. `Applying migration 20261027000001_deposit_return_alerts.sql...` 후 오류 없음
  2. `migration list` → 로컬·원격 모두 채워짐 (미적용 0)
  3. `check-schema.sql` → 4줄 모두 `t t`
  4. SQL Editor (읽기만): `select count(*) from public.notification_preferences where not public.valid_notification_categories(categories);` → 0
  5. 현재 앱에서 알림 설정 화면 열기·저장 → 성공
- **중단 조건**: 위 하나라도 실패 → 함수·APK 배포하지 않음

## 3단계 — 서버 함수 6개 (1·2단계 성공 후)
```powershell
npx supabase functions deploy analyze-contract protect-document protect-scan-page cleanup-orphans delete-account notifications
npx supabase functions list
```
- 성공 판정: 6개 모두 UPDATED_AT 이 방금 시각, VERSION 증가. 대시보드 → Edge Functions → 각 함수 Logs 에 배포 직후 오류 없음
- 확인 (현재 설치된 앱으로): 테스트 계약서 업로드 → 보호·분석 완료 (분석 결과가 이전 앱에서도 열림)
- **중단 조건**: 배포 오류, 로그에 반복 오류, 분석 실패 → APK 진행하지 않음. 함수 되돌리기는 0단계에서 기록한 이전 커밋으로 다시 배포 (`git checkout <이전 커밋> -- supabase/functions` 후 deploy — 그때 함께 진행)
- 참고: 이전 앱 + 새 분석 함수 — 새 분석은 렌탈 등도 방향을 "확인 필요"로 돌려줍니다. 이전 앱에서도 역할 카드로 정할 수 있어 동작은 하지만, "추천"과 홈 [맞아요]는 새 앱에서만 보입니다

## 4단계 — APK (1~3단계 모두 성공 후)
```powershell
npx eas-cli@latest build --platform android --profile preview
```
- 테스트 기기에 먼저 설치 → `docs/VERIFY_REAL_ANALYSIS.md` 실기기 점검
- **실제 AI 분석·푸시 알림은 이 점검을 마칠 때까지 "미검증"** 입니다 (완료로 보고하지 않음)
- 점검 통과 후 사용자 배포

## 되돌리기 (필요할 때만)
- B 되돌리기 (새 APK·새 notifications 함수를 먼저 이전 버전으로):
  SQL Editor에 `scripts/deploy/rollback/rollback-20261027000001.sql` 실행 → `npx supabase migration repair --linked --status reverted 20261027000001` → `check-schema.sql` 로 `f f` 확인
- A 되돌리기: `rollback-20261026000002.sql` 실행 → `npx supabase migration repair --linked --status reverted 20261026000002`
- SQL Editor로 실행하면 이력이 자동 기록되지 않으므로 **반드시 repair로 이력을 맞춘 뒤** `check-schema.sql` 로 history = schema 확인
- 데이터 손상이 확인된 경우에만 0단계 백업으로 복구 (복구는 함께 진행)
