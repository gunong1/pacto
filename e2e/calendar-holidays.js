/**
 * 캘린더 날짜 색상 — 일요일·공휴일 빨강 · 토요일 파랑 · 평일 기본 · 공휴일 이름 · 계약 일정 그대로 (390px 폭)
 * A 2026년 10월: 10/3(토·개천절)·10/4(일)·10/5(월·대체공휴일)·10/9(금·한글날) 빨강 · 10/10(토) 파랑 · 10/6(화) 기본
 * B 요일 머리글: 일 빨강 · 토 파랑
 * C 10/5 선택 → "공휴일 · 대체공휴일(개천절)" 표시 · 선택 강조(흰 글자) 유지
 * D 공휴일과 겹친 계약 일정도 그대로 표시 (mock 헬스장 월 회비 10/5 55,000원)
 * E 일반 날짜 선택 → 공휴일 이름 없음 · 날짜 칸이 화면 폭 안에 들어감
 * 사용: mock 모드 웹 실행 후 `node e2e/calendar-holidays.js`
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const RED = 'rgb(214, 57, 58)';
const BLUE = 'rgb(47, 107, 216)';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const color = (id) => page.locator(tid(id)).first().evaluate((e) => getComputedStyle(e).color);
  const text = async (id) => (await page.locator(tid(id)).first().innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.click(tid('tab-calendar'));
  await page.waitForSelector(tid('calendar-title'));
  for (let i = 0; i < 14 && !(await page.locator(tid('calendar-title')).innerText()).includes('2026년 10월'); i++) await page.click(tid('calendar-next'));

  const c = {};
  for (const d of ['03', '04', '05', '06', '09', '10']) c[d] = await color(`day-2026-10-${d}-num`);
  check('A', '10/3·4·5·9 빨강 · 10/10 파랑 · 10/6 기본', [c['03'], c['04'], c['05'], c['09']].every((x) => x === RED) && c['10'] === BLUE && c['06'] !== RED && c['06'] !== BLUE, JSON.stringify(c));
  const heads = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('div')].filter((e) => ['일', '토'].includes(e.textContent) && e.children.length === 0);
    return Object.fromEntries(cells.map((e) => [e.textContent, getComputedStyle(e).color]));
  });
  check('B', '요일 머리글: 일 빨강 · 토 파랑', heads['일'] === RED && heads['토'] === BLUE, JSON.stringify(heads));

  await page.click(tid('day-2026-10-05'));
  await page.waitForTimeout(400);
  const list = await text('calendar-day-list');
  const sel = await color('day-2026-10-05-num');
  check('C', '10/5 선택 → "공휴일 · 대체공휴일(개천절)" · 선택 날짜는 흰 글자', list.includes('공휴일 · 대체공휴일(개천절)') && sel === 'rgb(255, 255, 255)', `${list} / ${sel}`);
  check('D', '공휴일에 겹친 계약 일정 그대로 표시 (지급일 바뀌지 않음)', list.includes('헬스장 월 회비') && list.includes('55,000원'), list);
  await page.screenshot({ path: path.join(SHOTS, 'calendar-holidays-01.png') });

  await page.click(tid('day-2026-10-06'));
  await page.waitForTimeout(300);
  const box = await page.locator(tid('day-2026-10-10')).boundingBox();
  check('E', '일반 날짜 → 공휴일 이름 없음 · 토요일 칸이 화면 폭 안', (await page.locator(tid('calendar-holiday-name')).count()) === 0 && box && box.x + box.width <= 390, JSON.stringify(box));
  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
