/**
 * 홈 대시보드 순서·빈 상태 (실제 데이터 모드) — 계약 현황 → 다가오는 일정 → 이번 달 계약 금액
 * F 계약 0건 → 첫 등록 안내 유지
 * A 계약 1건(결제 없음·2년 뒤 만료) → "1개의 계약을 관리 중이에요" · 상태 1/0/0 · 순서 · 일정 없음 문구 · 출금·입금 0원 · 반복 안내 문구 없음 · 가로 스크롤 없음
 * D 100일 뒤 만료 계약 → 다가오는 일정에 계약명·D-day
 * B 20일 뒤 만료 계약 → 가장 가까운 일정이 맨 위 · 종료 예정 1 · [종료 예정] → 계약 목록 · [전체 보기] → 캘린더
 * 사용: BASE_URL=http://localhost:8082 node e2e/home-sections.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, name, ok });
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};
const kst = (n) => {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 1600 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const body = () => page.locator('body').innerText();
  const count = (id) => page.locator(tid(id)).count();
  const lease = async (title, start, end) => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    await page.click(tid('method-manual'));
    await page.click(tid('toggle-more')); // 직접 입력: 접힌 상세 정보 펼치기
    await page.click(tid('kind-lease')); // 부동산·임대차 → 임대차·부동산
    await input('field-title').fill(title);
    await input('field-startDate').fill(start);
    await input('field-endDate').fill(end);
    await page.click(tid('detail-leaseKind-monthly'));
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('home-spending'));
    await page.waitForTimeout(400);
  };
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`home-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
    check('F', '계약 0건 → 첫 계약 등록 안내 유지', (await count('home-first-run')) === 1);

    // A: 2년 뒤 끝나는 계약 1건 (결제 없음)
    await lease('먼 임대차', kst(-30), kst(700));
    const t = await body();
    const y = async (id) => (await page.locator(tid(id)).boundingBox()).y;
    check('A1', '"1개의 계약을 관리 중이에요" · 진행 중 1 · 종료 예정 0 · 갱신 예정 0', (await page.locator(tid('home-managed')).innerText()).includes('1개의 계약을 관리 중이에요') && (await page.locator(tid('home-status-live')).innerText()).startsWith('1') && (await page.locator(tid('home-status-ending_soon')).innerText()).startsWith('0') && (await page.locator(tid('home-status-renewal_due')).innerText()).startsWith('0'), t);
    check('A2', '순서: 계약 현황 → 다가오는 일정 → 이번 달 계약 금액', (await y('home-summary')) < (await y('home-upcoming')) && (await y('home-upcoming')) < (await y('home-money')));
    check('A3', '일정 없음 → "다가오는 계약 일정이 없어요." · 출금·입금 0원', (await count('home-upcoming-empty')) === 1 && (await page.locator(tid('home-spending-total')).innerText()).includes('₩0') && (await page.locator(tid('home-income-total')).innerText()).includes('₩0'));
    check('A4', '반복 안내 문구 없음 ("모두 총 출금 예정에 포함" · "출금과 별도예요") · 예전 섹션 없음', !t.includes('모두 총 출금 예정에 포함') && !t.includes('출금과 별도예요') && (await count('home-actions')) === 0 && (await count('home-ends')) === 0 && (await count('home-recent')) === 0);
    check('A5', '가로 스크롤 없음 (390px)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(SHOTS, 'home-01-empty-sections.png'), fullPage: true });

    // D: 100일 뒤 끝나는 계약 → 다가오는 일정
    await lease('곧 끝나는 임대차', kst(-300), kst(100));
    const d = await page.locator(tid('home-upcoming')).innerText();
    check('D', '100일 뒤 만료 → 다가오는 일정에 "곧 끝나는 임대차" · D-day', d.includes('곧 끝나는 임대차') && /D-\d+/.test(d), d);

    // B: 20일 뒤 끝나는 계약 → 가장 가까운 일정이 맨 위
    await lease('이번 달 끝나는 임대차', kst(-300), kst(20));
    const first = await page.locator(tid('home-upcoming-0')).innerText();
    const ending = await page.locator(tid('home-status-ending_soon')).innerText();
    check('B1', '가장 가까운 일정 맨 위 ("이번 달 끝나는 임대차") · 종료 예정 1 이상', first.includes('이번 달 끝나는 임대차') && Number(ending.trim().split(/\s/)[0]) >= 1, `${first} / ${ending}`);
    await page.screenshot({ path: path.join(SHOTS, 'home-02-with-sections.png'), fullPage: true });
    await page.click(tid('home-status-ending_soon'));
    await page.waitForTimeout(800);
    check('B2', '[종료 예정] → 계약 목록', page.url().includes('/contracts'), page.url());
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('home-upcoming'));
    await page.click(`${tid('home-upcoming')} >> text=전체 보기`);
    await page.waitForSelector(tid('calendar-title'), { timeout: 10000 }).catch(() => undefined);
    check('B3', '[전체 보기] → 캘린더', (await count('calendar-title')) === 1);
  } catch (e) {
    check('X', '예외 없음', false, e.message);
  }
  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
  if (results.some((r) => !r.ok)) process.exit(1);
})();
