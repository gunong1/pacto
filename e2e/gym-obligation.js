/**
 * 헬스장 1년권 — 금액의 의무 수준 E2E (실제 데이터 모드 + 서버 mock 공급자의 헬스장 예시 출력)
 * 1년 회원권 660,000원 일시불(확정) / 회원권 양도 수수료 30,000원(조건부) / 락커 월 5,000원(선택형)
 * 회귀: ① 양도 수수료 캘린더 없음 ② 지출 합산 안 됨 ③ 락커비 캘린더 없음 ④ 회원권만 확정 결제 ⑤ 1년을 월납 12회로 만들지 않음
 * + 락커 "이용 시작"을 등록하면 그때부터 결제로 반영
 * 사용: BASE_URL=http://localhost:8082 node e2e/gym-obligation.js  (기기 날짜 2026-10-06 기준)
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (no, name, ok, detail = '') => {
  results.push({ no, name, ok, detail });
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, detail ? `— ${detail}` : '');
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: Number(process.env.VIEWPORT_HEIGHT || 844) }, locale: 'ko-KR' });
  const page = await context.newPage();
  const errors = [];
  globalThis.__page = page;
  page.on('pageerror', (e) => errors.push(e.message));
  // 첫 분석 요청의 403은 AI 처리 동의 확인(동의 후 다시 요청) — 정상 흐름
  page.on('response', (r) => r.status() >= 400 && !(r.status() === 403 && r.url().endsWith('/analyze-contract')) && errors.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `gym-${n}.png`), fullPage: true });
  const text = (sel) => page.locator(sel).innerText();

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `gym-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // 확인 화면
  await page.click(tid('first-run-register'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '헬스장_1년권_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot('01-review');
  await page.locator(tid('section-payments')).screenshot({ path: path.join(SHOTS, 'gym-01b-review-payments.png') });
  const cards = await Promise.all([0, 1, 2].map((i) => text(tid(`payment-${i}`)).catch(() => '')));
  check('R', '확인 화면: 회원권 확정 · 양도 수수료 조건부 · 락커 선택형 (캘린더·지출 제외 표시)',
    !cards[0].includes('캘린더·지출 제외') && cards[1].includes('조건부 · 캘린더·지출 제외') && cards[2].includes('선택형 · 캘린더·지출 제외'),
    cards.map((c) => c.split('\n').slice(0, 2).join(' ')).join(' | '));

  // 저장 → 상세
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot('02-detail');
  const core = await text(tid('detail-core'));
  const extra = await text(tid('detail-extra-costs')).catch(() => '');
  check(4, '핵심 정보 결제는 1년 회원권 660,000원만', core.includes('1년 회원권') && core.includes('660,000원') && !core.includes('양도') && !core.includes('락커'), core.match(/1년 회원권\n[^\n]+/)?.[0]?.replace('\n', ' ') ?? '');
  check('D', '추가로 발생할 수 있는 비용: 양도 수수료(양도하는 경우) · 락커(이용하는 경우)',
    extra.includes('양도 수수료') && extra.includes('30,000원') && extra.includes('회원권을 양도하는 경우') && extra.includes('락커 이용료') && extra.includes('월 5,000원') && extra.includes('락커를 이용하는 경우'),
    extra.replace(/\n/g, ' / '));
  await page.locator(tid('detail-extra-costs')).screenshot({ path: path.join(SHOTS, 'gym-02b-extra-costs.png') });

  // 캘린더 — 1년치 월별 지출과 결제 일정
  const month = async (ym) => {
    await page.goto(`${BASE}/calendar?date=${ym}-15&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-month-total'), { timeout: 15000 });
    await page.waitForTimeout(300);
    return (await text(tid('calendar-month-total'))).replace(/\n/g, ' ');
  };
  const day = async (d) => {
    await page.goto(`${BASE}/calendar?date=${d}&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
    await page.waitForTimeout(300);
    return (await text(tid('calendar-day-list'))).replace(/\n/g, ' ');
  };
  const d1006 = await day('2026-10-06');
  await page.screenshot({ path: path.join(SHOTS, 'gym-03-calendar-1006.png') });
  const months = [];
  for (let i = 0; i < 13; i++) {
    const y = 2026 + Math.floor((9 + i) / 12);
    const m = ((9 + i) % 12) + 1;
    months.push([`${y}-${String(m).padStart(2, '0')}`, await month(`${y}-${String(m).padStart(2, '0')}`)]);
  }
  const amountOf = (t) => (t.match(/₩[\d,]+/) || ['?'])[0];
  const oct = months[0][1];
  const later = months.slice(1);
  check(1, '양도 수수료가 캘린더에 없음 (10/6 결제일에도)', !d1006.includes('양도'), d1006);
  check(2, '양도 수수료가 지출에 합산되지 않음 (10월 ₩660,000)', amountOf(oct) === '₩660,000', oct);
  check(3, '선택하지 않은 락커비가 캘린더·지출에 없음 (11월~이듬해 10월 모두 ₩0)', later.every(([, t]) => amountOf(t) === '₩0'), later.map(([ym, t]) => `${ym} ${amountOf(t)}`).join(', '));
  check('4b', '회원권 660,000원은 결제일(10/6)에 1회', d1006.includes('1년 회원권') && d1006.includes('660,000'), '');
  check(5, '1년 이용기간을 월납 12회로 만들지 않음', later.every(([, t]) => amountOf(t) === '₩0'), '');

  // 락커 이용 시작 → 결제로 전환
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('tab-contracts'));
  await page.locator(`${tid('contracts-list')} >> text=헬스장_1년권_계약서`).first().click();
  await page.waitForSelector(tid('detail-extra-costs'), { timeout: 15000 });
  const lockerBox = page.locator('[data-testid^="extra-"]').filter({ hasText: '락커 이용료' }).first();
  const lockerId = (await lockerBox.getAttribute('data-testid')).replace('extra-', '');
  await page.click(tid(`extra-${lockerId}-open`));
  await page.fill(`input${tid(`extra-${lockerId}-date`)}`, '261101');
  await page.locator(`input${tid(`extra-${lockerId}-date`)}`).blur();
  await page.click(tid(`extra-${lockerId}-save`));
  await page.waitForFunction(() => !document.body.innerText.includes('락커를 이용하는 경우'), null, { timeout: 15000 });
  const core2 = await text(tid('detail-core'));
  const nov = await month('2026-11');
  const d1101 = await day('2026-11-01');
  await page.screenshot({ path: path.join(SHOTS, 'gym-04-locker-activated.png') });
  check('A', '락커 "이용 시작"(11/1) 등록 → 그때부터 월 5,000원 결제·지출', core2.includes('락커 이용료') && amountOf(nov) === '₩5,000' && d1101.includes('락커 이용료'), `11월 ${amountOf(nov)} / ${d1101}`);

  console.log('\npage errors:', errors.length ? errors : 'none');
  require('fs').writeFileSync(path.join(SHOTS, 'gym-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  if (results.some((r) => !r.ok) || errors.length) process.exit(1);
})().catch(async (e) => {
  console.error('✘', e.message);
  await globalThis.__page?.screenshot({ path: path.join(SHOTS, 'gym-fail.png'), fullPage: true }).catch(() => undefined);
  process.exit(1);
});
