/**
 * 홈 대시보드 (mock 모드, 390px) — 계약 현황 → 다가오는 일정 → 이번 달 계약 금액
 * A 순서 · 계약 현황 문구·상태 3칸 · 다가오는 일정 3개 이하(가까운 순, D-day) · 반복 안내 문구 없음
 * B 출금 카드: 계약별 3줄 + "외 N건" · (보이는 줄 + 외 N건 금액) = 총액 · 펼치면 전체 줄의 합 = 총액 · 접기
 * C 아주 긴 계약명 + 큰 금액 → 계약명 말줄임 · 금액 잘리지 않음 · 가로 스크롤 없음
 * D 시급제 근로계약(당월 지급) → 입금 카드에 계약명·금액 · "세전 추정 근로소득이 포함되어 있어요" · 입금 총액 = 줄의 합
 * E 일정 누르면 계약 상세 · [진행 중] → 계약 목록 · [상세 보기] → 캘린더
 * 사용: mock 모드 웹 실행 후 `node e2e/home-dashboard.js`
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
const won = (t) => [...t.matchAll(/₩([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
const sum = (a) => a.reduce((x, y) => x + y, 0);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const input = (id) => page.locator(`input${tid(id)}`);
  const text = async (id) => (await page.locator(tid(id)).first().innerText()).replace(/\s+/g, ' ');
  const count = (id) => page.locator(tid(id)).count();
  const y = async (id) => (await page.locator(tid(id)).boundingBox()).y;
  const home = async () => {
    for (let i = 0; i < 4 && !(await page.locator(tid('tab-add')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(400);
    }
    await page.click(tid('tab-home'));
    await page.waitForSelector(tid('home-spending-total'));
    await page.waitForTimeout(400);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.waitForTimeout(500);

  // A
  const body = await page.locator('body').innerText();
  const up = await text('home-upcoming');
  const dd = [...up.matchAll(/D-(\d+)|D-DAY/g)].map((m) => (m[1] ? Number(m[1]) : 0));
  check('A1', '순서: 계약 현황 → 다가오는 일정 → 이번 달 계약 금액', (await y('home-summary')) < (await y('home-upcoming')) && (await y('home-upcoming')) < (await y('home-money')));
  check('A2', '"N개의 계약을 관리 중이에요" · 진행 중·종료 예정·갱신 예정', /\d+개의 계약을 관리 중이에요/.test(await text('home-managed')) && (await count('home-status-live')) === 1 && (await count('home-status-ending_soon')) === 1 && (await count('home-status-renewal_due')) === 1);
  check('A3', '다가오는 일정 1~3개 · 가까운 순 D-day', dd.length >= 1 && dd.length <= 3 && dd.every((d, i) => i === 0 || dd[i - 1] <= d), up);
  check('A4', '반복 안내 문구 없음', !body.includes('모두 총 출금 예정에 포함') && !body.includes('모두 총 입금 예정에 포함') && !body.includes('출금과 별도예요'));
  await page.screenshot({ path: path.join(SHOTS, 'home-dash-01.png') });

  // B
  const total = won(await text('home-spending-total'))[0];
  const shown = won(await text('home-spending-lines'));
  const more = await text('home-spending-more');
  // 줄 영역 글자에는 3줄 금액과 "외 N건 · ₩…" 금액이 함께 있다 → 합 = 총액
  check('B1', '출금 카드: 3줄 + "외 N건" · 보이는 줄 + 외 N건 금액 = 총액', (await count('home-spending-line-2')) === 1 && (await count('home-spending-line-3')) === 0 && /외 \d+건/.test(more) && shown.length === 4 && sum(shown) === total, `${total} / ${shown} / ${more}`);
  await page.click(tid('home-spending-more'));
  await page.waitForTimeout(300);
  const all = won(await text('home-spending-lines'));
  check('B2', '펼치면 전체 줄 · 줄의 합 = 총액', (await count('home-spending-line-3')) === 1 && sum(all) === total, `${all} / ${total}`);
  await page.click(tid('home-spending-more'));
  await page.waitForTimeout(300);
  check('B3', '접기 → 다시 3줄', (await count('home-spending-line-3')) === 0);

  // C 긴 계약명 + 큰 금액
  await page.click(tid('tab-add'));
  await page.click(tid('method-manual'));
  await page.waitForSelector(tid('quick-basic'));
  await input('field-title').fill('아주아주 긴 이름의 프리미엄 종합 관리 서비스 정기 이용 계약 (가족 공유형 연간 플랜)');
  await input('quick-amount').fill('987654321');
  await input('quick-day').fill('28');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await home();
  const line0 = page.locator(tid('home-spending-line-0'));
  const overflow = await line0.evaluate((el) => {
    const texts = [...el.querySelectorAll('div')].filter((d) => d.children.length === 0);
    const title = texts.find((d) => d.textContent.includes('아주아주'));
    const amount = texts.find((d) => d.textContent.includes('₩987,654,321'));
    return { ellipsis: title ? title.scrollWidth > title.clientWidth : null, amountFull: amount ? amount.scrollWidth <= amount.clientWidth + 1 : null };
  });
  check('C', '긴 계약명 말줄임 · 큰 금액 잘리지 않음 · 가로 스크롤 없음', overflow.ellipsis === true && overflow.amountFull === true && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), JSON.stringify(overflow));
  await page.screenshot({ path: path.join(SHOTS, 'home-dash-02-long.png') });

  // D 시급제 근로계약 (당월 지급 · 9월 입사 → 이번 달 입금)
  await page.click(tid('tab-add'));
  await page.click(tid('method-manual'));
  await page.waitForSelector(tid('quick-basic'));
  await input('field-title').fill('카페 아르바이트');
  await page.click(tid('kind-employment'));
  await page.click(tid('pay-basis-hourly'));
  await input('pay-hourlyWage').fill('13000');
  await input('pay-dailyWorkHours').fill('4');
  for (const d of [1, 2, 3, 4, 5]) await page.click(tid(`pay-weekday-${d}`));
  await page.click(tid('pay-holiday-included'));
  await page.click(tid('pay-timing-same_month'));
  await input('quick-day').fill('31');
  await input('field-startDate').fill('260901');
  await input('field-startDate').blur();
  await page.waitForTimeout(400);
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await home();
  const inc = await text('home-income');
  const incTotal = won(await text('home-income-total'))[0];
  check('D1', '입금 카드: "카페 아르바이트" · 금액 · 입금 총액 = 줄의 합', inc.includes('카페 아르바이트') && incTotal > 0 && sum(won(await text('home-income-lines'))) === incTotal, inc);
  check('D2', '"세전 추정 근로소득이 포함되어 있어요. 실제 수령액과 다를 수 있습니다."', (await text('home-income-note')).includes('세전 추정 근로소득이 포함되어 있어요. 실제 수령액과 다를 수 있습니다.'));
  await page.screenshot({ path: path.join(SHOTS, 'home-dash-03-income.png'), fullPage: true });

  // E 이동
  await page.click(tid('home-upcoming-0'));
  await page.waitForSelector(tid('detail-core'), { timeout: 10000 }).catch(() => undefined);
  check('E1', '일정 누르면 계약 상세', (await count('detail-core')) === 1);
  await home();
  await page.click(tid('home-status-live'));
  await page.waitForTimeout(800);
  check('E2', '[진행 중] → 계약 목록', page.url().includes('/contracts'), page.url());
  await home();
  await page.click(`${tid('home-money')} >> text=상세 보기`);
  await page.waitForSelector(tid('calendar-title'), { timeout: 10000 }).catch(() => undefined);
  check('E3', '[상세 보기] → 캘린더 (월 금액)', (await count('calendar-month-total')) === 1);

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
