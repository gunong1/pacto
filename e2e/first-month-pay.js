/**
 * 근로 — 중도 입사 첫 달 예상 급여 · 직접 입력과 수정 화면이 같은 항목·순서·값인지
 * 재현: 입사 2026-10-13 · 시급 13,000원 · 하루 4시간 · 월~금 · 주휴수당 포함 · 익월 지급 · 지급일 10일
 * A 급여 영역: 급여 방식 → 단가 → 근무 요일 → 주휴수당 → 예상 월 수입 → 급여 산정·지급(마감일·당월/익월 지급) — 원 단위 처리 칸 없음
 * B 근무 요일 월~금을 고르면 주 근무일수 5 · 첫 급여 미리보기 832,000원 (10월 소정근로일 22일 중 14일 · 11/10 지급)
 * C 저장 → 상세 급여 카드: 첫 급여 (근무일 계산) 832,000 = 기본급 728,000 + 주휴수당 104,000 · 입사 주 확인 필요
 * D 캘린더 11/10: 832,000원 첫 급여 (월평균 1,355,714원이 아님) · 12/10: 1,355,714원 (예상)
 * E 수정 화면: 같은 영역·순서, 저장된 값 그대로 (시급·요일·주휴·지급 시기·지급일·금액)
 * F 당월 지급으로 바꿔 저장 → 첫 급여가 10월로 이동 (같은 금액, 한 번만)
 * G 산정기간 마감일 25일 → 첫 급여 520,000 (평일 9일 468,000 + 주휴 1주 52,000)
 * H 당월 지급 · 지급일 25일 · 말일 마감 → "지급일이 마감일보다 빨라요" 안내 → [마감일을 25일로] → 520,000
 * I 지급일 아래 "지급일이 휴일이면" 선택 → 저장 후 다시 열면 그대로
 * 사용: `npm run web`(mock 모드) 실행 후 `node e2e/first-month-pay.js`
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const input = (id) => page.locator(`input${tid(id)}`);
  const text = async (id) => (await page.locator(tid(id)).first().innerText()).replace(/\s+/g, ' ');
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;
  const sel = async (id) => (await page.locator(tid(id)).getAttribute('aria-selected')) === 'true';
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `first-month-${n}.png`) });
  // 급여 영역 안 칸 순서 (testID 등장 순서)
  const order = async () =>
    page.evaluate(() => {
      const ids = ['pay-basis', 'pay-hourlyWage', 'pay-dailyWorkHours', 'pay-weeklyWorkDays', 'pay-weekdays', 'pay-weeklyHolidayPay', 'quick-amount', 'pay-estimate', 'payroll-rules', 'first-pay-preview'];
      const all = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
      return ids.filter((i) => all.includes(i)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
    });
  const backToTabs = async () => {
    for (let i = 0; i < 4 && !(await page.locator(tid('tab-add')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(400);
    }
  };
  const calendarDay = async (day) => {
    await backToTabs();
    await page.click(tid('tab-calendar'));
    await page.waitForSelector(tid('calendar-title'));
    const ym = `${Number(day.slice(0, 4))}년 ${Number(day.slice(5, 7))}월`;
    for (let i = 0; i < 14 && !(await page.locator(tid('calendar-title')).innerText()).includes(ym); i++) {
      const cur = await page.locator(tid('calendar-title')).innerText();
      const m = cur.match(/(\d+)년 (\d+)월/);
      await page.click(tid(Number(m[1]) * 12 + Number(m[2]) < Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) ? 'calendar-next' : 'calendar-prev'));
    }
    await page.click(tid(`day-${day}`));
    await page.waitForTimeout(400);
    return text('calendar-day-list');
  };
  const openContract = async () => {
    await backToTabs();
    await page.click(tid('tab-contracts'));
    await page.locator('[data-testid^="contract-row-"]', { hasText: '카페 아르바이트' }).first().click();
    await page.waitForSelector(tid('edit-contract'));
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.click(tid('tab-add'));
  await page.click(tid('method-manual'));
  await page.waitForSelector(tid('quick-basic'));
  await input('field-title').fill('카페 아르바이트');
  await page.click(tid('kind-employment'));
  await page.click(tid('pay-basis-hourly'));
  await input('pay-hourlyWage').fill('13000');
  await input('pay-dailyWorkHours').fill('4');

  // A
  const createOrder = await order();
  const rules = await text('payroll-rules');
  check('A', '급여 영역 순서: 방식 → 단가 → 근무 요일 → 주휴수당 → 예상 월 수입 → 급여 산정·지급 · 원 단위 처리 없음', createOrder.indexOf('pay-weekdays') > createOrder.indexOf('pay-dailyWorkHours') && createOrder.indexOf('payroll-rules') > createOrder.indexOf('pay-estimate') && rules.includes('급여 산정기간 마감일') && rules.includes('당월 지급') && rules.includes('익월 지급') && rules.includes('근무한 다음 달에 급여 지급') && !(await page.content()).includes('원 단위 처리'), JSON.stringify(createOrder));

  // B
  for (const d of [1, 2, 3, 4, 5]) await page.click(tid(`pay-weekday-${d}`));
  await page.click(tid('pay-holiday-included'));
  await page.click(tid('pay-timing-next_month'));
  await input('quick-day').fill('10');
  await input('field-startDate').fill('261013');
  await input('field-startDate').blur();
  await page.waitForTimeout(800);
  const preview = await text('first-pay-preview');
  check('B', '근무 요일 월~금 → 주 근무일수 5 · 첫 급여 미리보기 832,000 (22일 중 14일 · 11/10 지급) · 입사 주 확인 필요', (await input('pay-weeklyWorkDays').inputValue()) === '5' && preview.includes('832,000원') && preview.includes('소정근로일 22일 중 14일') && preview.includes('2026. 11. 10.') && preview.includes('확인 필요'), preview);
  check('B2', '예상 월 수입은 월평균 1,355,714 (첫 달 금액과 구분)', (await input('quick-amount').inputValue()) === '1,355,714');
  await shot('01-create');

  // C
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const card = (await page.locator('[data-testid^="salary-"]').first().innerText()).replace(/\s+/g, ' ');
  check('C', '상세: 첫 급여 (근무일 계산) 832,000 = 기본급 728,000(14일×4시간×13,000) + 주휴수당 104,000(2주) · 입사 주 확인 필요', card.includes('첫 급여 (근무일 계산)') && card.includes('832,000') && card.includes('근무일 14일 × 4시간 × 시급 13,000원') && card.includes('728,000') && card.includes('2주 × 52,000원') && card.includes('104,000') && card.includes('확인 필요'), card);
  await shot('02-detail');

  // D
  const nov = await calendarDay('2026-11-10');
  check('D1', '캘린더 11/10: 832,000원 첫 급여 (월평균 1,355,714 아님)', nov.includes('832,000') && nov.includes('첫 급여') && !nov.includes('1,355,714'), nov);
  const dec = await calendarDay('2026-12-10');
  check('D2', '캘린더 12/10: 1,355,714원 (예상) 월평균', dec.includes('1,355,714원 (예상)'), dec);
  const octPay = await calendarDay('2026-10-10');
  check('D3', '10/10에는 급여 없음 (입사 전)', !octPay.includes('급여'), octPay);

  // E
  await openContract();
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('pay-basis'));
  await page.waitForTimeout(500);
  const editOrder = await order();
  const vals = [await sel('pay-basis-hourly'), await input('pay-hourlyWage').inputValue(), await input('pay-dailyWorkHours').inputValue(), await sel('pay-weekday-1'), await sel('pay-weekday-5'), await sel('pay-weekday-6'), await sel('pay-holiday-included'), await sel('pay-timing-next_month'), await input('quick-day').inputValue(), await input('quick-amount').inputValue()];
  check('E1', '수정 화면 = 직접 입력 화면과 같은 항목·순서', JSON.stringify(editOrder) === JSON.stringify(createOrder.concat(createOrder.includes('first-pay-preview') ? [] : ['first-pay-preview'])) || JSON.stringify(editOrder) === JSON.stringify(createOrder), `${createOrder} / ${editOrder}`);
  check('E2', '수정 화면 값 그대로 (시급제·13,000·4·월~금·주휴 포함·익월·10일·1,355,714)', JSON.stringify(vals) === JSON.stringify([true, '13,000', '4', true, true, false, true, true, '10', '1,355,714']), JSON.stringify(vals));
  check('E3', '수정 화면 첫 급여 미리보기도 832,000', (await text('first-pay-preview')).includes('832,000원'));
  await shot('03-edit');

  // F 당월 지급 + 지급일 31일
  await page.click(tid('pay-timing-same_month'));
  await input('quick-day').fill('31');
  await page.waitForTimeout(400);
  const fPrev = await text('first-pay-preview');
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(800);
  const sheet = await page.locator(tid('amount-change-sheet')).count();
  if (sheet) await page.click(tid('amount-change-confirm')).catch(() => undefined);
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const oct = await calendarDay('2026-10-31');
  const novAfter = await calendarDay('2026-11-10');
  check('F', '당월 지급 → 첫 급여 832,000이 10/31로 이동 · 11/10에는 없음 (한 번만)', fPrev.includes('2026. 10. 31.') && oct.includes('832,000') && !novAfter.includes('832,000'), `${fPrev} / ${oct} / ${novAfter}`);

  // G 산정기간 마감일 25일
  await openContract();
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('pay-basis'));
  await page.click(tid('pay-period-custom'));
  await input('pay-period-end').fill('25');
  await page.waitForTimeout(500);
  const g = await text('first-pay-preview');
  check('G', '마감일 25일 → 9/26~10/25 산정 · 10/13~25 평일 9일 468,000 + 주휴 1주 52,000 = 520,000', g.includes('520,000원') && (await text('pay-period-text')).includes('매월 26일~다음 달 25일'), g);
  await shot('04-period25');

  // H 지급일이 마감일보다 빠를 때 안내
  await page.click('[role="button"][data-testid="pay-period-end"]');
  await input('quick-day').fill('25');
  await page.waitForTimeout(500);
  const warn = (await has('pay-early-warning')) ? await text('pay-early-warning') : '';
  const before = await text('first-pay-preview');
  await page.click(tid('pay-early-fix'));
  await page.waitForTimeout(500);
  const after = await text('first-pay-preview');
  check('H', '당월 지급 · 지급일 25일 · 말일 마감 → 안내 (832,000) → [마감일을 25일로] → 26일~25일 · 520,000 · 안내 사라짐', warn.includes('지급일(25일)이 급여 산정기간 마감일(말일)보다 빨라요') && before.includes('832,000원') && after.includes('520,000원') && (await text('pay-period-text')).includes('매월 26일~다음 달 25일') && !(await has('pay-early-warning')), `${warn} / ${before} / ${after}`);
  await shot('05-early-pay');

  // I 휴일 규칙
  const bizLabel = (await page.content()).includes('지급일이 휴일이면');
  await page.click(tid('quick-businessDay-previous'));
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(800);
  if (await page.locator(tid('amount-change-sheet')).count()) await page.click(tid('amount-change-confirm')).catch(() => undefined);
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await openContract();
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('pay-basis'));
  await page.waitForTimeout(400);
  check('I', '"지급일이 휴일이면" 칸 · 휴일이면 직전 영업일 저장 → 다시 열면 그대로 · 마감일 25일 유지', bizLabel && (await sel('quick-businessDay-previous')) && (await text('pay-period-text')).includes('매월 26일~다음 달 25일'));

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
