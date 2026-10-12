# 운영 배포 실행서 (2026-10-13 개정 · 승인 범위: 0단계만)

| 단계 | 내용 | 운영 변경 | 승인 |
|---|---|---|---|
| 0 | 사전 점검 + 백업 (읽기만) | 없음 | **승인됨** |
| 1 | 마이그레이션 A `20261026000002` | DB 함수 1개 교체 | 미승인 |
| 2 | 마이그레이션 B `20261027000001` | DB 함수·트리거·검사 조건 | 미승인 |
| 3 | 서버 함수 6개 (하나씩) | Edge Functions | 미승인 |
| 4 | APK | 앱 | 미승인 |

기준: 운영 `migration list` (사용자 확인) — 연결 프로젝트 **pacto · yoftnocpaxkbqqajgfvl · Seoul**
- 적용됨: 20261026000001 및 그 이전 전부 → **다시 실행하지 않음**
- 미적용: `20261026000002_old_client_guard` · `20261027000001_deposit_return_alerts` → 이 두 개만

실행 위치: Windows PowerShell · `C:\Users\김지은\pacto\pacto` · Supabase CLI **2.119.0**.
로컬 검증도 2.119.0으로 했습니다. 배포가 끝날 때까지 CLI를 업데이트하지 마세요.

**채팅에 보내지 않는 것**: 비밀번호, 토큰, 백업 파일(`schema.sql`·`data.sql`·`history.sql`), 계약서 원문, 개인정보.
**채팅에 보내도 되는 것**: 이 문서의 "보고할 내용"에 적힌 출력. 버전, 판정, 테이블 이름, 행 수가 해당합니다.

---

## 도구와 로컬 검증 결과

| 도구 | 하는 일 | 로컬에서 확인한 것 |
|---|---|---|
| `scripts/deploy/check-schema.sql` | 읽기 전용 SELECT 한 문장. 버전마다 이력 기록 여부와 실제 정의 지문을 비교 | 4가지 상태를 정확히 구분 (아래) |
| `scripts/deploy/backup-counts.sql` | 읽기 전용 SELECT 한 문장. 테이블별 행 수, id 지문, 행 내용 지문 | 접속 시간대가 달라도 같은 값 |
| `scripts/deploy/verify-backup.mjs` | 백업 파일을 끝까지 파싱해 테이블별 행 수와 id 지문을 계산하고 운영 집계와 대조 | 정상 PASS. 다음 4가지는 모두 FAIL: 행 1개 삭제, 파일 잘림, id 1글자 변경, 백업 뒤 운영에 행 추가 |
| `scripts/deploy/restore-test.mjs` (선택) | 백업을 **로컬** DB에 실제로 복원한 뒤 모든 행 내용 지문을 대조. 끝나면 로컬 DB를 지움 | 정상 PASS. 금액 1칸 변경도 FAIL로 잡음 (id 대조로는 못 잡는 경우) |
| `scripts/deploy/stage.mjs` | 지정 버전까지만 담은 임시 폴더 `.deploy-stage` 생성 | 원본이 커밋 상태와 다르면 중단 (수정·추가 둘 다). 복사 전후 원본 sha256이 같음. 복사본과 원본이 바이트 단위로 같음 |
| `scripts/deploy/gen-check-schema.mjs` | check-schema.sql의 기대값을 로컬 DB 두 상태에서 자동 생성 | 이미 적용된 항목은 두 상태 값이 같고, 미적용 항목은 값이 다름을 확인 |

### check-schema.sql 판정이 검증된 상태 (로컬)

| 상황 | 26000002 | 27000001 |
|---|---|---|
| 운영과 같은 상태 (20261026000001까지 적용) | NOT_APPLIED · PENDING | NOT_APPLIED · PENDING |
| SQL Editor로 26000002를 직접 실행 (이력 없음) | APPLIED · **REPAIR_CANDIDATE** | PENDING |
| 27000001 실행 후 트리거 하나 삭제 | — | **MISMATCH · STOP** |
| 이력만 있고 스키마 일부 + 알 수 없는 이력 | — | MISMATCH · STOP, 알 수 없는 이력 STOP |
| 되돌리기 SQL B→A + 이력 삭제 | NOT_APPLIED · PENDING | NOT_APPLIED · PENDING |

마지막 줄은 되돌리기 SQL이 함수 본문·제약·트리거를 적용 전 지문과 **정확히** 같게 되돌린다는 뜻입니다.

검사 항목은 36개입니다.
- 함수 본문 md5: `save_contract`, 보증금 가드 함수 3개, `valid_notification_categories`, 설정 보존 함수 등
- 제약 정의 md5: 포함 관계 검사, 금액 성격·근거 검사, fund 외래키, 알림 기준일 범위
- 트리거: 이름, 테이블, 함수, 시점, 활성 여부
- RLS 켜짐
- `contract_funds`·`fund_refunds` 정책 전체 md5
- 권한: 테이블 권한, 칸별 권한
- 칸: 타입, null 허용, 기본값
- `save_contract` 인자 개수

**한계**
- 지문은 로컬 PostgreSQL 17.11에서 만들었습니다. 운영의 메이저 버전이 다르면 정의 표기 차이로 MISMATCH가 날 수 있습니다. 운영 버전은 0단계에서 확인합니다.
- 데이터 내용(행 값)은 검사하지 않습니다. 이 SQL은 스키마 정의만 봅니다.

### 단계 적용 (로컬 재검증, 이번 개정 후)
- `stage.mjs 20261026000002` 후 `db push --workdir .deploy-stage --dry-run`: 목록이 정확히 1개입니다.
- 실제 적용 후 check-schema 결과: 26000002 OK, 27000001 PENDING.
- `stage.mjs 20261027000001` 후 같은 방법으로 진행하면 4개 모두 OK.
- CLI 2.119.0 확인 내용
  - `--workdir`: 전역 옵션입니다.
  - `db push`: `--linked`·`--local`·`--dry-run`·`--yes` 지원. 버전 하나만 지정하는 옵션은 없어서 임시 폴더 방식을 씁니다.
  - `db query`: `--linked`·`-f`·`-o csv` 지원. 한 번에 한 문장만 실행합니다.
  - `functions deploy`: 이름 여러 개 지원. 이번에는 하나씩 배포합니다.
  - `functions download`: `--project-ref`·`--use-api` 지원.
  - `functions list`: `--project-ref` 지원.

---

## 백업 범위 — 무엇이 들어가고 무엇이 빠지는가 (CLI 2.119.0 실제 출력 기준)

`db dump --data-only` 결과 형식
- 테이블마다 한 문장으로 된 `INSERT INTO "스키마"."테이블" (칸…) VALUES (…), (…);` 형식입니다. COPY는 쓰지 않습니다.
- 머리말에 `session_replication_role = replica`가 있습니다. 복원할 때 트리거와 외래키 검사를 끕니다.
- `analysis_jobs`와 `contracts`는 서로를 참조합니다. 그래서 이 모드 없이는 복원 순서 문제가 생깁니다. pg_dump도 이에 대해 경고합니다.

| 데이터 | 백업 파일 | 확인 방법 |
|---|---|---|
| 계약 `contracts` | data.sql 포함 | id 지문 + (선택) 내용 지문 |
| 금액 `contract_payments` | 포함 | 〃 |
| 금액 변경 이력 `contract_payment_changes` | 포함 | 〃 |
| 보증금 묶음 `contract_funds` | 포함 | 〃 |
| 반환 기록 `fund_refunds` | 포함 | 〃 |
| 일정·문서 기록·보호 기록·프로필 | 포함 | 〃 |
| 사용자 인증 `auth.users`·`auth.identities` | 포함 (비밀번호는 해시 상태) | 〃 |
| 로그인 세션·토큰 `auth.sessions`·`refresh_tokens` | 포함 | 앱을 쓰는 동안 바뀌므로 차이는 경고로만 표시 |
| 알림 설정·예약·기록, 푸시 토큰 | 포함 | 〃 (예약·기록은 계속 바뀜) |
| Storage 파일 목록 `storage.objects` | 포함 (**목록만**) | 〃 |
| **계약서 파일 자체 (PDF·사진)** | **없음** | 이번 마이그레이션은 Storage를 건드리지 않음 |
| 테이블·함수·정책 정의 (public) | schema.sql | public 테이블 정의가 모두 있는지 검증기가 확인 |
| auth·storage 스키마 정의 | 없음 | Supabase가 관리합니다 |
| 마이그레이션 이력 `supabase_migrations` | 기본 덤프에 **없음** → `history.sql`로 따로 백업 | `migration list` 출력과 대조 |
| 예약 작업 `cron`, 비밀값 `vault`, `auth.schema_migrations`·`storage.migrations` | **없음** | cron 작업은 마이그레이션이 만든 것이라 마이그레이션으로 다시 만들 수 있음. vault 비밀값은 백업되지 않음 |

### 검증 기준 (파일 크기나 문자열 개수로 판단하지 않습니다)
1. **형식**: 다음을 모두 만족해야 합니다.
   - 머리말에 replica 모드가 있음
   - `standard_conforming_strings = on`
   - 끝이 `RESET ALL;`로 끝남 (잘리지 않았다는 뜻)
   - 모든 INSERT가 따옴표와 괄호 짝이 맞고 `;`로 끝남
   - 행마다 칸 수가 맞음
2. **id 대조**: 백업 직후 운영에서 집계한 값과 핵심 테이블 12개가 같아야 합니다. 비교 항목은 행 수와 id 지문입니다.
   - 계약·금액·변경 이력·보증금·반환·일정·문서·문서 보호 2종·프로필·사용자·로그인 연결
   - 하나라도 다르면 FAIL입니다.
3. **(선택) 복원 시험**: 로컬 DB에 실제로 복원한 뒤 모든 테이블의 행 내용 지문이 같아야 합니다.
   - id는 같은데 금액 한 칸이 다른 경우도 잡습니다.
   - 로컬 Docker가 있어야 합니다.

**한계**
- 복원 시험을 하지 않으면 확인되는 것은 "행이 빠짐없이 들어 있다"까지입니다. "모든 값이 정확하다"는 확인되지 않습니다.
- 운영 자체 복구 기능(대시보드 Backups, PITR)이 있는지는 요금제에 따라 다릅니다. 현재 요금제는 **알 수 없습니다** (0단계에서 화면으로 확인).

### 운영 데이터 복구가 필요할 때 할 수 있는 것과 한계
- **이번 2개 마이그레이션은 데이터를 바꾸지 않습니다.** 문제가 생기면 먼저 되돌리기 SQL로 정의만 되돌립니다 (아래 "되돌리기"). 데이터 복구는 데이터 손상이 확인된 경우에만 합니다.
- 백업으로 복구하는 방법: 한 트랜잭션 안에서 replica 모드로 대상 테이블을 비운 뒤 data.sql을 적용합니다. 복원 시험과 같은 방식입니다.
  - 로컬에서는 성공을 확인했습니다.
  - **운영에 실제로 해 본 적은 없습니다.** 실제로 할 때는 다시 계획하고 승인받습니다.
- 복구하면 백업 시점 이후의 변경이 모두 사라집니다. 대상은 사용자가 새로 등록·수정한 계약, 가입, 로그인 세션입니다.
- 사용자가 많이 쓰는 시간을 피하고, 1~2단계를 백업 직후 바로 진행하는 것이 손실을 줄입니다.
- 복구할 수 없는 것
  - Storage 파일 (백업에 없음)
  - vault 비밀값
  - 백업 이후 생긴 데이터

---

## 0단계 — 사전 점검 + 백업 (운영을 바꾸지 않음)

모든 명령은 읽기만 합니다.
- 실행하는 SQL은 SELECT 한 문장입니다 (`db query`는 여러 문장을 받지 않습니다).
- `db dump`는 읽기만 합니다.
- `functions download`는 운영 코드를 내려받기만 합니다.

### 0-0. 준비
```powershell
cd C:\Users\김지은\pacto\pacto
git pull
git status --short                 # 출력 없음이어야 함
npx supabase --version             # 2.119.0
npx supabase projects list         # 연결 표시(●)가 yoftnocpaxkbqqajgfvl 인지
$B = "$env:USERPROFILE\pacto-backups\$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $B | Out-Null
$B                                 # 저장소(C:\Users\김지은\pacto\pacto) 밖인지 확인
```
- 백업 폴더는 저장소 밖에 둡니다 (git에 올라가지 않음).
- OneDrive 같은 동기화 폴더 안이면 다른 위치를 쓰세요.
- 중단 조건
  - `git status`에 출력이 있음
  - CLI 버전이 다름
  - 연결 프로젝트가 다름

### 0-1. 마이그레이션 이력 · DB 버전
```powershell
npx supabase migration list --linked
npx supabase db query --linked "select current_setting('server_version') as server_version"
```
- 기대
  - 20261026000001까지는 Local과 Remote가 모두 채워져 있습니다.
  - 20261026000002와 20261027000001은 Remote가 비어 있습니다.
  - Remote에만 있는 버전은 없습니다.
- `db query --linked`는 Management API로 실행합니다. 로그인 상태에 따라 동작하지 않을 수 있습니다 (**확실하지 않음**). 그때는 대시보드 SQL Editor에서 같은 SQL을 실행하세요.

### 0-2. 실제 스키마 점검
```powershell
npx supabase db query --linked -o csv -f scripts/deploy/check-schema.sql | Out-File -Encoding utf8 "$B\check-schema.csv"
Select-String -Path "$B\check-schema.csv" -Pattern '^(version|extra_history),'
Select-String -Path "$B\check-schema.csv" -Pattern ',UNEXPECTED,'
```
(SQL Editor를 쓰는 경우: 파일 전체를 붙여 넣고 실행합니다. `kind`가 version인 줄과 `result`가 UNEXPECTED인 줄을 확인합니다.)

| 버전 | 기대 결과 (result · history_recorded · action) |
|---|---|
| 20261025000002 | APPLIED · true · OK |
| 20261026000001 | APPLIED · true · OK |
| 20261026000002 | NOT_APPLIED · false · PENDING |
| 20261027000001 | NOT_APPLIED · false · PENDING |
| extra_history 줄 | 없음 |

- **중단 조건**: 위와 한 줄이라도 다르면 진행하지 않습니다.
  - STOP이나 MISMATCH가 나오면 해당 버전의 UNEXPECTED 항목 이름을 공유합니다. 원인을 함께 확인합니다.
  - REPAIR_CANDIDATE가 나오면 그 버전이 **이력 없이 정확히 적용돼 있다**는 뜻입니다. 이때도 바로 repair 하지 않고 먼저 공유합니다.
  - 이미 적용된 두 버전(25000002·26000001)이 MISMATCH이고 DB 버전이 17이 아니면 표기 차이일 수 있습니다. 그래도 repair·진행 없이 공유합니다.
- **migration repair 원칙**: 다음 두 조건이 모두 확인될 때만 제안합니다.
  - 이력과 실제 적용 상태가 다름
  - 실제 정의가 해당 버전의 기대값과 **항목 전부** 정확히 같음 (REPAIR_CANDIDATE)
  - 이력을 맞춰 문제를 감추는 용도로는 쓰지 않습니다.

### 0-3. 서버 함수 현재 버전 + 코드 백업
```powershell
npx supabase functions list --project-ref yoftnocpaxkbqqajgfvl | Out-File -Encoding utf8 "$B\functions-list.txt"
Get-Content "$B\functions-list.txt"
New-Item -ItemType Directory -Force "$B\functions\supabase" | Out-Null
Copy-Item supabase\config.toml "$B\functions\supabase\config.toml"
foreach ($f in 'protect-scan-page','protect-document','analyze-contract','notifications','delete-account','cleanup-orphans') {
  npx supabase functions download $f --workdir "$B\functions" --project-ref yoftnocpaxkbqqajgfvl --use-api
  if ($LASTEXITCODE -ne 0) { Write-Host "중단: $f 다운로드 실패"; break }
}
Get-ChildItem "$B\functions\supabase\functions" -Directory | Select-Object Name
git status --short                 # 출력 없음이어야 함 (저장소 코드가 덮어써지지 않았는지)
```
- `--workdir`를 주면 다운로드가 저장소가 아니라 백업 폴더 안에 저장됩니다. 이 동작은 운영 프로젝트가 있어야 확인할 수 있어서 로컬에서는 **확인하지 못했습니다**. 그래서 마지막 `git status`로 저장소가 그대로인지 확인합니다.
- 중단 조건
  - 다운로드가 실패함
  - 폴더 6개가 없음
  - `git status`에 `supabase/functions` 변경이 보임. 이 경우 `git checkout -- supabase/functions`로 되돌리고 공유합니다.
- 운영에 지금 어떤 커밋의 코드가 배포돼 있는지는 **알 수 없습니다**. 그래서 내려받은 코드가 되돌리기의 기준입니다.

### 0-4. 백업 + 검증
```powershell
npx supabase db dump --linked -f "$B\schema.sql"
npx supabase db dump --linked --data-only -s supabase_migrations -f "$B\history.sql"
npx supabase db dump --linked --data-only -f "$B\data.sql"
npx supabase db query --linked -o csv -f scripts/deploy/backup-counts.sql | Out-File -Encoding utf8 "$B\counts.csv"
node scripts/deploy/verify-backup.mjs "$B\data.sql" --counts "$B\counts.csv" --schema "$B\schema.sql"
```
- DB 비밀번호를 물으면 직접 입력합니다. 채팅에는 보내지 않습니다.
- `counts.csv`는 data.sql을 받은 **직후** 만듭니다. 그 사이 사용자가 계약을 수정하면 FAIL이 날 수 있습니다. 그때는 마지막 두 줄(data.sql·counts.csv)을 한 번만 다시 실행합니다.
- 판정
  - **PASS**: 마지막 줄이 `결과: PASS`, 종료 코드 0.
    - 각 줄의 OK는 일치, EXCLUDED는 원래 덤프에 없는 테이블입니다.
    - WARN은 앱 사용 중 계속 바뀌는 테이블입니다 (세션·알림 등).
  - **중단 조건**: 다음 중 하나라도 해당하면 1단계로 가지 않습니다.
    - FAIL 줄이 있음
    - 형식 오류가 있음
    - 다시 실행해도 핵심 테이블 FAIL이 남음
    - 덤프 명령이 실패함
- (선택, 로컬 Docker Desktop과 `npx supabase start`가 될 때만) 복원 시험
  ```powershell
  node scripts/deploy/restore-test.mjs "$B\data.sql" --counts "$B\counts.csv" --version 20261026000001 --yes-reset-local
  ```
  - **로컬 DB를 지웁니다.** 끝나면 운영 데이터 사본이 남지 않게 한 번 더 지웁니다.
  - Windows에서 이 스크립트를 실행해 본 적은 없습니다 (**확실하지 않음**).
  - 시험을 못 하면 "값 정확성은 미확인"으로 남깁니다.
- 대시보드 → Database → Backups에서 자동 백업과 PITR이 있는지, 최근 시각이 언제인지 확인합니다.

### 0단계 보고할 내용 (이것만 보내 주세요)
1. `migration list` 출력 (버전 표만)
2. `server_version` 값
3. check-schema의 version 줄 4개, extra_history 줄 유무, UNEXPECTED 줄의 항목 이름
4. `functions-list.txt` 내용 (NAME · VERSION · UPDATED_AT · STATUS)과 다운로드 폴더 이름 6개, `git status` 결과
5. `verify-backup.mjs` 출력 전체 (테이블 이름·행 수·판정만 있음)
6. (했다면) `restore-test.mjs` 마지막 줄
7. 대시보드 Backups 화면의 자동 백업·PITR 유무

백업 파일 자체와 비밀번호는 보내지 않습니다.

---

## 1단계 — 마이그레이션 A (20261026000002) · 미승인
```powershell
node scripts/deploy/stage.mjs 20261026000002
npx supabase db push --workdir .deploy-stage --linked --dry-run
npx supabase db push --workdir .deploy-stage --linked
```
- `stage.mjs` 출력 확인
  - 적용 대상이 `20261026000002_old_client_guard.sql`
  - `대상 sha256(LF 기준)` = `b1eb9390fde23e271e337b7fe51afba0d74280bc077c1e52fc896ceb28c2f67c`
  - "원본 변경 없음 · 복사본 일치 확인"
- dry-run 목록은 정확히 그 파일 1개여야 합니다. 아니면 중단합니다.
- 성공 판정
  - 적용 출력에 오류가 없음
  - `migration list`에서 26000002의 Remote가 채워짐
  - check-schema가 26000002 OK, 27000001 PENDING
  - 현재 앱으로 기존 계약을 수정·저장할 수 있음

## 2단계 — 마이그레이션 B (20261027000001) · 미승인
```powershell
node scripts/deploy/stage.mjs 20261027000001
npx supabase db push --workdir .deploy-stage --linked --dry-run
npx supabase db push --workdir .deploy-stage --linked
```
- `대상 sha256(LF 기준)` = `0229448971d8eff019436ca00c063b44bb9c9f566d86d14fef067a614f5e3e7f`
- dry-run 목록은 정확히 1개여야 합니다.
- 성공 판정
  - check-schema가 4개 모두 OK이고 extra_history가 없음
  - 현재 앱에서 알림 설정을 저장할 수 있음
- **둘 다 성공하기 전에는 새 APK를 배포하지 않습니다.**
  - 로컬 실험 결과: B가 없으면 새 앱의 알림 설정 저장이 거부됩니다.
  - 26000001이 없으면 계약 목록 조회가 실패합니다.

## 3단계 — 서버 함수 (하나씩 배포·확인) · 미승인
`functions deploy`는 이름 여러 개를 한 번에 받을 수 있습니다. 하지만 하나가 실패했을 때 어디까지 바뀌었는지 분명하도록 **하나씩** 배포합니다. 순서는 아래와 같습니다.
1. `protect-scan-page`: protect-document가 부르는 worker라서 먼저 배포합니다.
2. `protect-document`
3. `analyze-contract`
4. `notifications`: 2단계(B)의 새 알림 종류가 필요합니다.
5. `delete-account`
6. `cleanup-orphans`: 매시간 cron이 부릅니다.

함수마다 아래를 반복합니다.
```powershell
npx supabase functions deploy <이름> --project-ref yoftnocpaxkbqqajgfvl --use-api
npx supabase functions list --project-ref yoftnocpaxkbqqajgfvl
```
- 판정
  - 배포 오류가 없음
  - 그 함수만 VERSION이 1 오르고 UPDATED_AT이 방금 시각임
  - 대시보드 Logs에 기동 오류가 없음
- 기능 확인
  - 1~3: 가짜 계약서로 보호·분석이 끝나는지 확인합니다.
  - 4: 실기기 확인 전까지는 **미검증**입니다.
  - 5: 실제 계정으로 시험하지 않고 기동 로그만 봅니다.
  - 6: 다음 정각 실행 로그에 오류가 없는지 봅니다.
- **중단 조건**: 하나라도 실패하면 다음 함수를 배포하지 않습니다. 실패한 함수만 되돌립니다.
- 함수 되돌리기 (**로컬 검증 안 됨**)
  ```powershell
  npx supabase functions deploy <이름> --workdir "$B\functions" --project-ref yoftnocpaxkbqqajgfvl --use-api
  ```
  - 0-3에서 내려받은 코드를 다시 배포하는 방법입니다.
  - 내려받은 코드를 그대로 다시 배포할 수 있는지는 운영에서만 확인할 수 있습니다. 그래서 첫 함수(protect-scan-page)를 배포하기 **전에** 다음을 먼저 봅니다.
    - `$B\functions\supabase\functions\protect-scan-page`에 `index.ts`가 있는지
    - `_shared` 같은 의존 파일이 함께 내려왔는지
  - 의존 파일이 없으면 되돌리기 수단이 불확실하다는 뜻입니다. 그 경우 3단계 진행 여부를 다시 정합니다.

## 4단계 — APK · 미승인
- 1~3단계가 모두 성공한 뒤에만 진행합니다.
- 테스트 기기에서 `docs/VERIFY_REAL_ANALYSIS.md`로 점검합니다.
- **실제 AI 분석과 푸시 알림은 실기기 점검을 마칠 때까지 "미검증"입니다.**

## 되돌리기 (필요할 때만, 별도 승인)
- B 먼저 되돌립니다. 새 APK와 새 notifications 함수가 있다면 그것부터 이전 버전으로 돌립니다.
  1. SQL Editor에서 `scripts/deploy/rollback/rollback-20261027000001.sql`을 실행합니다.
  2. check-schema로 27000001이 `NOT_APPLIED · true · STOP`인지 확인합니다. 이력은 아직 남아 있는 상태입니다.
  3. 정의가 적용 전과 **정확히** 같다는 것이 확인됐을 때만 `npx supabase migration repair --linked --status reverted 20261027000001`을 실행합니다.
  4. check-schema로 `NOT_APPLIED · false · PENDING`인지 확인합니다.
- A도 같은 방식으로 되돌립니다. `rollback-20261026000002.sql`을 실행한 뒤 위와 같이 확인하고 repair 합니다.
- 되돌리기 SQL이 적용 전 지문과 정확히 같아지는 것은 로컬에서 확인했습니다.
