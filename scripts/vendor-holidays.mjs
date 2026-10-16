#!/usr/bin/env node
/**
 * 대한민국 공휴일 데이터 옮기기 → src/domain/holidaysKr.data.ts
 * 사용: npm pack @hyunbinseo/holidays-kr@<버전> 후 압축을 푼 폴더를 인자로
 *   node scripts/vendor-holidays.mjs <압축 푼 package 폴더> <버전>
 * 패키지 코드는 실행하지 않는다 — dist/YYYY-*.js 의 "YYYY-MM-DD": ["이름"] 줄만 텍스트로 읽는다.
 * 새 연도(매년 월력요항 발표 후 패키지 갱신)나 임시공휴일이 생기면 다시 실행한다.
 */
import fs from 'node:fs';
import path from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) {
  console.error('사용: node scripts/vendor-holidays.mjs <package 폴더> <버전>');
  process.exit(1);
}
const dist = path.join(dir, 'dist');
const out = {};
for (const f of fs.readdirSync(dist).filter((n) => /^\d{4}-.*\.js$/.test(n)).sort()) {
  const text = fs.readFileSync(path.join(dist, f), 'utf8');
  for (const m of text.matchAll(/"(\d{4}-\d{2}-\d{2})":\s*\[([^\]]*)\]/g)) out[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const keys = Object.keys(out).sort();
const years = [...new Set(keys.map((k) => k.slice(0, 4)))];
const q = (s) => `'${s.replace(/'/g, "\\'")}'`;
const body = [
  '/**',
  ' * 대한민국 공휴일 (캘린더 날짜 색상·공휴일 이름 표시 전용 — 결제일·지급일 계산에는 쓰지 않는다)',
  ` * 출처: npm @hyunbinseo/holidays-kr@${version} (MIT) — 우주항공청 발표 월력요항(관보) 기준. 대체공휴일·임시공휴일(선거일 등) 포함`,
  ' * 생성: scripts/vendor-holidays.mjs (패키지 코드를 실행하지 않고 데이터만 옮김). 음력 명절·대체공휴일을 앱에서 계산하지 않는다',
  ` * 수록 연도: ${years[0]}~${years[years.length - 1]} — 그 밖의 연도는 공휴일 정보가 없음 (주말 색상만)`,
  ' */',
  `export const HOLIDAY_YEARS = { from: ${years[0]}, to: ${years[years.length - 1]} } as const;`,
  'export const KR_HOLIDAYS: Readonly<Record<string, readonly string[]>> = {',
  ...keys.map((k) => `  ${q(k)}: [${out[k].map(q).join(', ')}],`),
  '};',
  '',
].join('\n');
fs.writeFileSync('src/domain/holidaysKr.data.ts', body);
console.log(`wrote src/domain/holidaysKr.data.ts (${keys.length}일, ${years[0]}~${years[years.length - 1]})`);
