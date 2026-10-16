// 알림 번들 두 개(예: 배포된 커밋 vs 새 커밋)로 같은 계약의 알림 계획을 만들어 비교한다 — 로컬 Supabase 전용 (읽기만)
//   node scripts/deploy/compare-notification-bundles.mjs <예전 번들.mjs> <새 번들.mjs> [기준 시각 ISO]
// 서비스 키는 `npx supabase status`(로컬)에서만 읽는다. 계약 내용은 출력하지 않고 차이 건수·종류·금액만 출력한다.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [oldPath, newPath, nowIso = '2026-10-16T00:00:00Z'] = process.argv.slice(2);
const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8' }).split('\n').map((l) => l.match(/^(\w+)="(.*)"$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!/127\.0\.0\.1|localhost/.test(env.API_URL)) throw new Error('로컬 Supabase에서만 실행합니다');
const db = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const load = async (p) => import(pathToFileURL(path.resolve(p)).href);
const [A, B] = [await load(oldPath), await load(newPath)];
const now = new Date(nowIso);

const rows = async (select) => {
  const out = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('contracts').select(`user_id, ${select}`).range(from, from + 499);
    if (error) throw error;
    out.push(...data);
    if (data.length < 500) return out;
  }
};
const byUser = (list) => list.reduce((m, r) => m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]), new Map());
const [ra, rb] = [byUser(await rows(A.CONTRACT_SELECT)), byUser(await rows(B.CONTRACT_SELECT))];
const prefs = (M) => ({ enabled: true, defaultTimes: ['09:00'], timezone: 'Asia/Seoul', showDetails: true, categories: M.normalizeCategoryPrefs(undefined) });
const plan = (M, userId, list) => M.planNotifications({ userId, records: list.map(M.toRecord), preferences: prefs(M), overrides: new Map(), now });
const key = (p) => p.dedupeKey + '#' + p.eventKey;
const strip = (p) => JSON.stringify(p);

let users = 0, total = [0, 0], same = 0, changed = [], added = [], removed = [], errors = 0;
for (const [userId, list] of ra) {
  users++;
  let pa, pb;
  try { pa = plan(A, userId, list); pb = plan(B, userId, rb.get(userId) ?? []); } catch (e) { errors++; console.log('오류', e.message); continue; }
  total[0] += pa.length; total[1] += pb.length;
  const mb = new Map(pb.map((p) => [key(p), p]));
  for (const p of pa) {
    const q = mb.get(key(p));
    if (!q) removed.push(p);
    else if (strip(p) === strip(q)) same++;
    else changed.push([p, q]);
    mb.delete(key(p));
  }
  added.push(...mb.values());
}
console.log(`사용자 ${users}명 · 계약 ${[...ra.values()].flat().length}건 · 기준 ${nowIso}`);
console.log(`알림 계획: 예전 ${total[0]}건 / 새 ${total[1]}건 · 같음 ${same} · 내용 바뀜 ${changed.length} · 새로 생김 ${added.length} · 없어짐 ${removed.length} · 계산 오류 ${errors}`);
const diffFields = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const summary = new Map();
for (const [a, b] of changed) {
  const f = diffFields(a, b).join(',');
  const kind = `${a.eventType} [${f}]`;
  summary.set(kind, (summary.get(kind) ?? 0) + 1);
}
for (const [k, n] of summary) console.log(`  바뀜 ${k}: ${n}건`);
for (const [a, b] of changed.slice(0, 5)) console.log(`  예) ${a.eventType} ${a.eventDate}: "${a.display.message}" → "${b.display.message}"`);
for (const p of [...added, ...removed].slice(0, 5)) console.log(`  ${added.includes(p) ? '생김' : '없어짐'} ${p.eventType} ${p.eventDate} ${p.display.message}`);
