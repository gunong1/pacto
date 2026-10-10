/**
 * 캘린더 연도·월 빠른 이동 — 제목(연·월) 누르기 → 연도 목록 + 1~12월 → 월을 누르면 바로 이동 / "오늘"로 이번 달 복귀 / 좌우 화살표는 그대로 한 달씩
 * 사용: `npm run web`(mock 모드) 실행 후 BASE_URL=http://localhost:8081 node e2e/calendar-jump.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}`, !ok && detail ? `— ${detail}` : '');
  if (!ok) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const title = async () => ((await page.locator(tid('calendar-title')).innerText()).match(/\d{4}년 \d{1,2}월/) ?? [''])[0];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const thisMonth = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.click(tid('tab-calendar'));
  await page.waitForSelector(tid('calendar-title'));
  check(`처음: 이번 달 (${thisMonth}) · "오늘" 버튼 없음`, (await title()) === thisMonth && (await page.locator(tid('calendar-today')).count()) === 0);

  // 좌우 화살표는 그대로 한 달씩
  await page.click(tid('calendar-next'));
  const next = (await title()).trim();
  await page.click(tid('calendar-prev'));
  check(`화살표: 한 달씩 (${next} → ${thisMonth})`, next !== thisMonth && (await title()) === thisMonth);

  // 제목 → 빠른 이동
  await page.click(tid('calendar-title'));
  await page.waitForSelector(tid('month-picker'));
  const yearOn = await page.locator(`${tid(`month-picker-year-${now.getFullYear()}`)}[aria-selected="true"]`).count();
  check('제목 누르면 연도·월 선택 (보고 있는 연도 선택됨)', yearOn === 1);
  await page.screenshot({ path: path.join(SHOTS, 'calendar-jump-1-picker.png') });
  await page.click(tid('month-picker-year-2031'));
  await page.click(tid('month-picker-month-3'));
  await page.waitForTimeout(300);
  check('2031년 → 3월 누르면 바로 2031년 3월로 (시트 닫힘)', (await title()) === '2031년 3월' && (await page.locator(tid('month-picker')).count()) === 0);
  check('다른 달이면 "오늘" 버튼 표시', (await page.locator(tid('calendar-today')).count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, 'calendar-jump-2-2031.png') });

  // 다시 열면 2031년에서 시작 · 연도만 바꾸고 닫으면 이동하지 않음
  await page.click(tid('calendar-title'));
  await page.waitForSelector(tid('month-picker'));
  check('다시 열면 보고 있는 연도(2031) 선택', (await page.locator(`${tid('month-picker-year-2031')}[aria-selected="true"]`).count()) === 1);
  await page.click(tid('month-picker-year-2040'));
  await page.click(tid('month-picker-close'));
  await page.waitForTimeout(200);
  check('연도만 고르고 닫으면 그대로 (2031년 3월)', (await title()) === '2031년 3월');

  // 화살표는 빠른 이동 후에도 한 달씩
  await page.click(tid('calendar-next'));
  check('빠른 이동 후 화살표 → 2031년 4월', (await title()) === '2031년 4월');

  // "오늘" (헤더)
  await page.click(tid('calendar-today'));
  await page.waitForTimeout(200);
  check(`헤더 "오늘" → 이번 달 (${thisMonth}) 한 번에 복귀 · 버튼 사라짐`, (await title()) === thisMonth && (await page.locator(tid('calendar-today')).count()) === 0);

  // 시트 안 "오늘"
  await page.click(tid('calendar-title'));
  await page.click(tid('month-picker-year-2028'));
  await page.click(tid('month-picker-month-12'));
  await page.click(tid('calendar-title'));
  await page.click(tid('month-picker-today'));
  await page.waitForTimeout(200);
  check('시트 안 "오늘" → 이번 달', (await title()) === thisMonth);
  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
