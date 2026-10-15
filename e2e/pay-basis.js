/**
 * 근로 — 급여 방식(월급제·시급제·일급제·연봉제) 직접 입력 → 저장 → 계약 상세 → 캘린더 → 홈 수입 → 수정
 * A 근로를 고르면 "급여 방식" 칩 (기본 월급제) · 금액 칸 이름 "월급" · 고용 형태와 별개 안내
 * B 일급제: 일급 + 월 예상 근무일수 → 예상 월 수입 자동 계산 (세전 기본급 추정 · 수당·공제 미포함 안내)
 * C 시급제: 시급 + 하루 근무시간 + 월 예상 근무일수 → 예상 월 수입 = 시급 × 시간 × 일수, 금액 칸에 채움
 * D 예상액을 직접 고치면 유지 (근무일수를 바꿔도 덮어쓰지 않음) · "계산값으로" 누르면 계산값
 * E 저장 → 상세 급여 카드: 시급제 · 예상 월 수입 (세전 기본급 추정) · 계산식 · 실제 수령액과 다름
 * F 캘린더: 지급일에 "(예상)" 급여 + "시급제 · 세전 기본급 추정" · 입금 예정 카드 "세전 예상 … 포함"
 * G 홈: 총 입금 예정에 예상 수입 포함 안내
 * H 수정 화면: 급여 방식·시급·근무시간·근무일수·금액 그대로
 * I 월급제(기본) 저장 → 상세 "세전 고정 월 급여" (예상 표시 없음)
 * 사용: `npm run web`(mock 모드) 실행 후 `node e2e/pay-basis.js`
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
// 오늘(한국 시간) + n일
const kstDate = (n) => new Date(Date.now() + 9 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const text = async (id) => (await page.locator(tid(id)).first().innerText()).replace(/\s+/g, ' ');
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `pay-basis-${n}.png`), fullPage: true });
  const backToTabs = async () => {
    for (let i = 0; i < 4 && !(await page.locator(tid('tab-add')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(400);
    }
  };
  const openManual = async (title) => {
    await backToTabs();
    await page.click(tid('tab-add'));
    await page.click(tid('method-manual'));
    await page.waitForSelector(tid('quick-basic'));
    await input('field-title').fill(title);
    await page.click(tid('kind-employment'));
    await page.waitForSelector(tid('pay-basis'));
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));

  // A
  await openManual('카페 아르바이트');
  const a = await text('quick-payment');
  check('A', '근로 → 급여 방식 칩(월급제 선택) · 금액 칸 "월급" · 고용 형태와 별개', (await page.locator(tid('pay-basis-monthly')).getAttribute('aria-selected')) === 'true' && a.includes('급여 방식') && a.includes('월급') && a.includes('고용 형태(정규직·계약직·아르바이트)와 따로'), a.slice(0, 200));
  await shot('01-monthly');

  // B 일급제
  await page.click(tid('pay-basis-daily'));
  const dailyFields = (await has('pay-dailyWage')) && (await has('pay-monthlyWorkDays')) && !(await has('pay-hourlyWage')) && !(await has('pay-dailyWorkHours'));
  await input('pay-dailyWage').fill('120000');
  await input('pay-monthlyWorkDays').fill('20');
  await page.waitForTimeout(300);
  const b = await text('pay-estimate');
  check('B', '일급제: 일급·근무일수 칸만 → 예상 월 수입 2,400,000원 (세전 기본급 추정 · 수당·공제 미포함)', dailyFields && b.includes('2,400,000원') && b.includes('일급 120,000원 × 월 20일') && b.includes('세전 기본급 추정') && b.includes('주휴수당') && b.includes('4대보험'), b);
  check('B2', '일급제 → 금액 칸 이름 "예상 월 수입" + 계산값 채움', (await input('quick-amount').inputValue()) === '2,400,000' && (await text('quick-payment')).includes('예상 월 수입'));

  // C 시급제
  await page.click(tid('pay-basis-hourly'));
  check('C1', '시급제: 시급·하루 근무시간·월 예상 근무일수 칸 (일급 칸 숨김)', (await has('pay-hourlyWage')) && (await has('pay-dailyWorkHours')) && (await has('pay-monthlyWorkDays')) && !(await has('pay-dailyWage')));
  const missing = await text('pay-estimate');
  await input('pay-hourlyWage').fill('10030');
  await input('pay-dailyWorkHours').fill('8');
  await input('pay-monthlyWorkDays').fill('22');
  await page.waitForTimeout(300);
  const c = await text('pay-estimate');
  check('C2', '시급 10,030 × 8시간 × 22일 = 1,765,280원 → 금액 칸에 채움', c.includes('1,765,280원') && c.includes('시급 10,030원 × 하루 8시간 × 월 22일') && (await input('quick-amount').inputValue()) === '1,765,280', `${missing} / ${c}`);
  await shot('02-hourly');

  // D 직접 고친 예상액 유지
  await input('quick-amount').fill('1700000');
  await input('pay-monthlyWorkDays').fill('20');
  await page.waitForTimeout(300);
  const d1 = await input('quick-amount').inputValue();
  const d = await text('pay-estimate');
  check('D1', '예상액을 고치면 근무일수를 바꿔도 고친 금액 유지 + "직접 고친 금액" 안내', d1 === '1,700,000' && d.includes('1,604,800원') && d.includes('직접 고친 금액 1,700,000원'), `${d1} / ${d}`);
  await page.click(tid('pay-estimate-apply'));
  await page.waitForTimeout(200);
  check('D2', '"계산값으로" → 1,604,800', (await input('quick-amount').inputValue()) === '1,604,800' && !(await has('pay-estimate-edited')));

  // E 저장 → 상세
  const day = kstDate(3);
  await input('quick-day').fill(String(Number(day.slice(8))));
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const salary = page.locator('[data-testid^="salary-"]').first();
  const e = (await salary.innerText()).replace(/\s+/g, ' ');
  check('E', '상세 급여: 시급제 · 예상 월 수입 (세전 기본급 추정) 1,604,800원 · 계산식 · 실제 수령액과 다름', e.includes('시급제') && e.includes('예상 월 수입 (세전 기본급 추정)') && e.includes('1,604,800') && e.includes('시급 10,030원 × 하루 8시간 × 월 20일') && e.includes('실제 수령액과 달라요') && !e.includes('첫 급여 자동 계산'), e);
  await shot('03-detail');

  // F 캘린더
  await backToTabs();
  await page.click(tid('tab-calendar'));
  await page.waitForSelector(tid('calendar-title'));
  const ym = `${Number(day.slice(0, 4))}년 ${Number(day.slice(5, 7))}월`;
  for (let i = 0; i < 2 && !(await page.locator(tid('calendar-title')).innerText()).includes(ym); i++) await page.click(tid('calendar-next'));
  await page.click(tid(`day-${day}`));
  await page.waitForTimeout(400);
  const f = await text('calendar-day-list');
  const inCard = await text('calendar-month-total-in');
  check('F1', '캘린더 지급일: +1,604,800원 (예상) 급여 · 시급제 · 세전 기본급 추정', f.includes('1,604,800원 (예상)') && f.includes('시급제 · 세전 기본급 추정'), f);
  check('F2', '입금 예정 카드: "세전 예상 … 포함"', inCard.includes('세전 예상') && inCard.includes('포함'), inCard);
  await shot('04-calendar');

  // G 홈 (이번 달 지급이면)
  await page.click(tid('tab-home'));
  await page.waitForSelector(tid('home-spending-total'));
  if (day.slice(0, 7) === kstDate(0).slice(0, 7)) {
    const g = await text('home-income');
    check('G', '홈 총 입금 예정: 예상 수입 포함 · 실제 수령액과 다름 안내', g.includes('1,604,800') && g.includes('예상 수입') && g.includes('실제 수령액과 달라요'), g);
  } else console.log('- G. 지급일이 다음 달이라 홈(이번 달) 확인 생략');

  // H 수정 화면
  await page.click(tid('tab-contracts'));
  await page.locator('[data-testid^="contract-row-"]', { hasText: '카페 아르바이트' }).first().click();
  await page.waitForSelector(tid('edit-contract'));
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('pay-basis'));
  const h = [await page.locator(tid('pay-basis-hourly')).getAttribute('aria-selected'), await input('pay-hourlyWage').inputValue(), await input('pay-dailyWorkHours').inputValue(), await input('pay-monthlyWorkDays').inputValue(), await input('quick-amount').inputValue()];
  check('H', '수정 화면: 시급제 · 10,030 · 8 · 20 · 1,604,800 그대로', JSON.stringify(h) === JSON.stringify(['true', '10,030', '8', '20', '1,604,800']), JSON.stringify(h));
  await shot('05-edit');

  // I 월급제
  await openManual('회사 근로계약');
  await input('quick-amount').fill('2500000');
  await input('quick-day').fill('25');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const i = (await page.locator('[data-testid^="salary-"]').first().innerText()).replace(/\s+/g, ' ');
  check('I', '월급제: 상세 "세전 고정 월 급여" 2,500,000원 · 예상 표시 없음', i.includes('월급제') && i.includes('세전 고정 월 급여') && i.includes('2,500,000') && !i.includes('추정'), i);

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
