/* Edge Function용 도메인 번들이 원본(src/domain)과 같은지 — 다르면: node scripts/vendor-domain.mjs */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const BUNDLE = path.join(ROOT, 'supabase/functions/_shared/vendor/pacto-domain.js');

test('번들 원본 해시가 현재 원본과 같음', () => {
  const head = fs.readFileSync(BUNDLE, 'utf8').slice(0, 2000);
  const hash = /source-hash: (\w+)/.exec(head)![1];
  const sources = /sources: (.+)/.exec(head)![1].split(',');
  const h = crypto.createHash('sha256');
  for (const f of [...sources].sort()) h.update(f).update('\0').update(fs.readFileSync(path.join(ROOT, f))).update('\0');
  expect(h.digest('hex').slice(0, 16)).toBe(hash);
});
