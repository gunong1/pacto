# 운영 업그레이드 리허설 (로컬 전용 — 운영 DB에 쓰지 않음)

운영 DB가 마이그레이션 20261025000001까지 적용된 상태라고 가정하고, 나머지 4개(20261025000002 · 20261026000001 · 20261026000002 · 20261027000001)를 적용했을 때 기존 데이터가 그대로인지 확인합니다.
**로컬 DB를 지웁니다.** 운영 프로젝트에 연결된 상태에서 실행하지 마세요 (`--local`만 사용).

```bash
npx supabase db reset --local --version 20261025000001      # 로컬 DB를 4개 적용 전 상태로
SERVICE_ROLE_KEY=... ANON_KEY=... node scripts/upgrade-rehearsal/seed-old-schema.mjs /tmp/rehearsal-seed.json   # 예전 앱 모양 데이터 (가짜)
npx supabase migration up --local                            # 4개 적용
REHEARSAL_SEED=/tmp/rehearsal-seed.json npx jest -c jest.integration.config.js src/__integration__/upgrade-rehearsal.test.ts
```
키는 `npx supabase status -o json`의 SERVICE_ROLE_KEY · ANON_KEY (로컬 기본값).
