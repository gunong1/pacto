# 배포 계획 — 당사자 자동 연결 · 역할 확인 · 지급 방향 (2026-10-12 기준, 아직 배포 안 함)

> 이 문서는 계획입니다. 운영 DB·서버 함수·APK 배포는 승인 후 진행합니다.
> 운영 DB에 실제로 어떤 마이그레이션이 적용돼 있는지는 이 환경에서 확인할 수 없습니다(알 수 없음).
> 배포 전에 아래 0단계 명령으로 직접 확인해 주세요.

## 0. 운영 상태 확인 (읽기만, 바꾸지 않음)
```powershell
cd C:\Users\김지은\pacto\pacto
git pull
npx supabase link --project-ref yoftnocpaxkbqqajgfvl
npx supabase migration list            # Local / Remote 열 비교 — Remote가 비어 있는 줄이 미적용
npx supabase functions list            # 함수별 최근 배포 시각
```

## 1. 마이그레이션 4개 — 목적 · 데이터 영향 · 의존 · 롤백
네 파일 모두 **기존 행을 바꾸는 문장이 없습니다** (UPDATE·DELETE·INSERT는 전부 `save_contract` 함수 본문 안에 있고, 마이그레이션 실행 시점에는 실행되지 않음).

| 순서 | 파일 | 목적 | 데이터 영향 | 필요로 하는 것 | 롤백 |
|---|---|---|---|---|---|
| 1 | 20261025000002_auto_excluded_pages | 글자를 읽지 못한 페이지를 서버가 자동 제외한 기록 칸 | contract_documents에 칸 추가(기본값 빈 배열) + 검사 조건. 기존 값 변경 없음 | 없음 (20261025000001 이후) | 쉬움: 제약·칸 삭제 + guard 함수를 20261025000001 정의로 되돌림 |
| 2 | 20261026000001_cashflow_parties | 돈의 성격·방향 근거·지급자/수령자·보증금 묶음·반환 기록·내 계약자 이름 | 칸·테이블 추가(빈 값). save_contract 교체(옛 7인자 → 새 8인자, 새 인자는 기본값 있음 → 예전 앱 호출 그대로 동작) | 없음 | **어려움**: 배포 후 저장된 보증금 묶음·반환 기록·성격·이름이 지워짐 → 되돌리기보다 고쳐서 앞으로 진행 권장 |
| 3 | 20261026000002_old_client_guard | 구버전 앱이 결제 id 없이 저장해 정보를 지우는 것을 차단 | 함수만 교체 (데이터 변경 없음) | 2 | 쉬움: save_contract를 2번 파일 정의로 다시 생성 |
| 4 | 20261027000001_deposit_return_alerts | 보증금 반환 확인 알림 종류 · 기준일 뒤 알림(음수 offset) · 묶음/반환 변경 시 재계산 · 구버전 앱 설정 보존 | 검사 조건 교체·트리거 추가. 기존 설정·예정 알림 값 변경 없음 | 2 (contract_funds·fund_refunds 트리거) | 보통: 트리거 삭제 + 검사 조건 되돌림. 단 되돌리기 전에 `_v`·`deposit_return` 키와 음수 offset 예정 알림을 먼저 정리해야 옛 조건을 통과 |

### 왜 4개가 함께 필요한가 (새 앱·새 함수와의 의존)
- **새 앱**은 계약을 읽을 때 `contract_funds(fund_refunds)`를 함께 읽음 → 2가 없으면 계약 목록이 열리지 않음.
- **새 앱**의 알림 설정 저장은 `_v: 2`를 붙임 → 4가 없으면 설정 저장이 거부됨.
- **notifications 함수**(새 번들)는 보증금 반환 알림(음수 offset·deposit_return)을 만듦 → 4가 없으면 계획 저장 실패.
- **protect-document·analyze-contract**(새 코드)는 `analysis_auto_excluded_pages`를 씀 → 1이 없으면 보호 처리 실패.
- 이번 변경(당사자 연결·역할 확인)은 **새 마이그레이션이 없음** (parties jsonb에 `term`만 추가로 저장).

### 권장 실행 순서 (한 번에 적용하지 않고 한 단계씩 확인)
1. 백업 확인: Supabase 대시보드 → Database → Backups에서 최근 백업 시각 확인 (요금제에 따라 다름 — 알 수 없음)
2. 마이그레이션 1 → 확인: `select count(*) from contract_documents where analysis_auto_excluded_pages <> '{}'` = 0
3. 마이그레이션 2 → 확인: 기존 계약 목록이 기존 앱에서 그대로 열리는지, `select count(*) from contract_funds` = 0
4. 마이그레이션 3 → 확인: 기존 앱으로 계약 하나 수정·저장 (정보가 없는 계약은 그대로 저장돼야 함)
5. 마이그레이션 4 → 확인: 알림 설정 화면 열기·저장
6. 서버 함수 6개 배포 (마이그레이션 4개 이후)
7. APK 빌드 (함수 배포 이후)

`npx supabase db push`는 미적용 파일을 한꺼번에 적용합니다. 한 단계씩 하려면 대시보드 SQL Editor에 파일 내용을 하나씩 실행하거나, 확인 후 다음 파일로 진행해 주세요 (방법은 승인 시 함께 정함).

## 2. 서버 함수
| 함수 | 이번에 바뀐 점 | 필요한 마이그레이션 |
|---|---|---|
| analyze-contract | 지시문 v17 · 당사자 같은 자리 연결 · 대표자 분리 · 분석 단계에서 방향을 정하지 않음 | 1 |
| protect-document · protect-scan-page | 자동 제외 페이지 기록 (이전 커밋) | 1 |
| notifications | 공통 번들(읽을 때 정리 규칙·보증금 반환 알림) | 2, 4 |
| cleanup-orphans · delete-account | 공통 코드 묶음 갱신 (동작 변화 없음 — 추측입니다, 같은 _shared를 쓰므로 함께 배포 권장) | 2 |

```powershell
npx supabase functions deploy analyze-contract protect-document protect-scan-page notifications cleanup-orphans delete-account
```

## 3. APK
```powershell
npx eas-cli@latest build --platform android --profile preview
```
새 APK는 2·4가 적용된 DB가 필요합니다. 함수 배포 후 빌드하세요.

## 4. 기존 데이터·기존 사용자 영향
- 렌탈·구독·통신·교육·할부·보험·대출 계약 중 **예전 분석이 계약 구조로 출금을 정한 결제(방향 근거 contract)**는, 새 앱에서 사용자가 역할을 확인하기 전까지 "방향 확인 필요"로 보입니다 → 홈 출금 합계가 줄어 보일 수 있음. 홈에 계약별 "추천: 고객 [맞아요]"가 보이고 한 번 누르면 원래대로 합계에 들어갑니다.
- 사용자가 예전에 직접 고른 방향·직접 입력한 계약(방향 근거 user 또는 없음)·확정한 역할은 그대로입니다.
- DB 값은 읽기만으로 바뀌지 않고, 사용자가 저장(맞아요·수정 저장)할 때 같은 결제 id로 갱신됩니다.
- 구버전 APK: 정보가 지워질 수 있는 저장은 막히고 "저장하지 못했어요"만 보입니다(업데이트 안내 문구 아님). 구버전 APK는 역할 확인 전 결제를 예전처럼 출금으로 보여줄 수 있습니다 (DB 값 기준 — 추측입니다).
