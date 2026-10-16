/**
 * 계약 목록 기본 필터 = 진행중 (실제 데이터 모드) · 만료 표시 (30일 이내 D-day / 31일 이상 날짜 / 만료일 없음 표시 없음)
 * 계약 6개: 진행(만료 +200일) · 종료 임박(+20일) · 갱신 예정(+20일 자동갱신) · 종료(−10일) · 해지(해지 처리) · 만료일 없음
 * A 계약 탭 처음 → "진행중" 선택 · 진행·종료 임박·갱신 예정·만료일 없음만 (종료·해지 없음)
 * B 표시: 진행 = "YYYY. M. D. 만료" · 종료 임박·갱신 예정 = D-20 · 만료일 없음 = D-day·날짜 없음
 * C "전체" → 6개 모두 · "종료·해지" → 종료·해지 2개
 * D 다른 필터 선택 후 홈 갔다 와도 선택 유지
 * E 홈 [종료 예정] → "종료 임박" 필터로 종료 임박 계약만 · [갱신 예정] → 갱신 예정 계약만
 * F 검색 "갱신" → 갱신 예정 계약만 · 종류 "부동산·임대차" 칩 → 같은 결과 유지
 * 사용: BASE_URL=http://localhost:8082 node e2e/contracts-filter.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const kd = (n) => new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
const yymmdd = (n) => {
  const d = kd(n);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};
const dotted = (n) => {
  const d = kd(n);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
};
const ALL = ['진행 계약', '종료 임박 계약', '갱신 예정 계약', '종료된 계약', '해지한 계약', '만료일 없는 계약'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 1600 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const listText = async () => (await page.locator(tid('contracts-list')).innerText()).replace(/\s+/g, ' ');
  const shown = async () => {
    const t = await listText();
    return ALL.filter((n) => t.includes(n));
  };
  const sel = async (id) => (await page.locator(tid(id)).getAttribute('aria-selected')) === 'true';
  const lease = async (title, start, end, auto = false) => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    await page.click(tid('method-manual'));
    await page.click(tid('toggle-more'));
    await page.click(tid('kind-lease'));
    await input('field-title').fill(title);
    await input('field-startDate').fill(start);
    if (end) await input('field-endDate').fill(end);
    await page.click(tid('detail-leaseKind-monthly'));
    if (auto) await page.click(tid('field-autoRenewal'));
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  };
  const tab = async (name) => {
    await page.click(tid(`tab-${name}`));
    await page.waitForTimeout(600);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await input('sign-up-email').fill(`filter-${Date.now()}@pacto.test`);
  await input('sign-up-password').fill('pacto-ui-password-1');
  await input('sign-up-confirm').fill('pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  await lease('진행 계약', yymmdd(-100), yymmdd(200));
  await lease('종료 임박 계약', yymmdd(-300), yymmdd(20));
  await lease('갱신 예정 계약', yymmdd(-300), yymmdd(20), true);
  await lease('종료된 계약', yymmdd(-400), yymmdd(-10));
  await lease('해지한 계약', yymmdd(-100), yymmdd(200));
  await page.click(tid('lifecycle-button'));
  await page.waitForTimeout(1500);
  await lease('만료일 없는 계약', yymmdd(-100), null);

  // A·B: 새로 열기 (앱 처음 진입과 같게)
  await page.goto(BASE + '/contracts', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('contracts-list'));
  await page.waitForTimeout(800);
  const a = await shown();
  check('A', '처음 진입 → "진행중" 선택 · 진행·종료 임박·갱신 예정·만료일 없음 (종료·해지 제외)', (await sel('filter-status-live')) && JSON.stringify(a) === JSON.stringify(['진행 계약', '종료 임박 계약', '갱신 예정 계약', '만료일 없는 계약'].filter((n) => a.includes(n))) && a.length === 4 && !a.includes('종료된 계약') && !a.includes('해지한 계약'), JSON.stringify(a));
  const row = async (title) => (await page.locator('[data-testid^="contract-row-"]', { hasText: title }).first().innerText()).replace(/\s+/g, ' ');
  const live = await row('진행 계약');
  const ending = await row('종료 임박 계약');
  const renew = await row('갱신 예정 계약');
  const none = await row('만료일 없는 계약');
  check('B', `진행 "${dotted(200)} 만료" · 종료 임박·갱신 예정 D-20 · 만료일 없음은 D-day·날짜 없음`, live.includes(`${dotted(200)} 만료`) && !/D-\d+/.test(live) && ending.includes('D-20') && renew.includes('D-20') && renew.includes('갱신 예정') && !/D-\d+|\d+\. 만료/.test(none), `${live} | ${ending} | ${renew} | ${none}`);
  await page.screenshot({ path: path.join(SHOTS, 'contracts-filter-01-live.png'), fullPage: true });

  // C
  await page.click(tid('filter-status-all'));
  await page.waitForTimeout(300);
  const all = await shown();
  await page.click(tid('filter-status-closed'));
  await page.waitForTimeout(300);
  const closed = await shown();
  check('C', '"전체" → 6개 · "종료·해지" → 종료·해지 2개', all.length === 6 && closed.length === 2 && closed.includes('종료된 계약') && closed.includes('해지한 계약'), `${all} / ${closed}`);

  // D 선택 유지
  await page.click(tid('filter-status-all'));
  await tab('home');
  await tab('contracts');
  check('D', '"전체" 선택 → 홈 갔다 와도 "전체" 유지', (await sel('filter-status-all')) && (await shown()).length === 6);

  // E 홈 상태 칸에서 진입
  await tab('home');
  await page.click(tid('home-status-ending_soon'));
  await page.waitForTimeout(800);
  const e1 = await shown();
  const e1sel = await sel('filter-status-ending_soon');
  await tab('home');
  await page.click(tid('home-status-renewal_due'));
  await page.waitForTimeout(800);
  const e2 = await shown();
  check('E', '홈 [종료 예정] → 종료 임박 필터 · [갱신 예정] → 갱신 예정 필터', e1sel && JSON.stringify(e1) === JSON.stringify(['종료 임박 계약']) && (await sel('filter-status-renewal_due')) && JSON.stringify(e2) === JSON.stringify(['갱신 예정 계약']), `${e1} / ${e2}`);

  // F 검색·종류
  await page.click(tid('filter-status-live'));
  await page.locator(`input${tid('contracts-search')}`).fill('갱신');
  await page.waitForTimeout(300);
  const f1 = await shown();
  await page.click('text=부동산·임대차');
  await page.waitForTimeout(300);
  const f2 = await shown();
  check('F', '진행중 + 검색 "갱신" → 갱신 예정 계약만 · 종류 칩 함께 적용', JSON.stringify(f1) === JSON.stringify(['갱신 예정 계약']) && JSON.stringify(f2) === JSON.stringify(['갱신 예정 계약']), `${f1} / ${f2}`);

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
