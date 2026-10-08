/**
 * 홈 — 데이터가 없는 섹션은 그리지 않는다 ("없어요" 카드 없음, 빈 여백 없음)
 * F 계약 0건 → 첫 등록 안내 유지 / A·C·E 확인 필요 0건 · 곧 종료 0건 → 두 섹션 모두 없음, 지출 → 내 계약으로 바로 이어짐
 * D 곧 종료(180일 이내) 1건 → 섹션 표시 / B 30일 안 일정 1건 → "지금 확인이 필요한 계약 1건" 표시
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
    await page.click(tid('type-lease'));
    await input('field-title').fill(title);
    await page.click(tid('category-real_estate'));
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

    // A·C·E: 2년 뒤 끝나는 계약 1건 (결제 없음)
    await lease('먼 임대차', kst(-30), kst(700));
    const t = await body();
    check('A', '확인 필요 0건 → "지금 확인이 필요한 계약" 섹션 없음', (await count('home-actions')) === 0 && !t.includes('지금 확인이 필요한 계약') && !t.includes('30일 안에 챙길'));
    check('C', '곧 종료 0건 → "곧 종료·갱신되는 계약" 섹션 없음', (await count('home-ends')) === 0 && !t.includes('곧 종료·갱신되는 계약') && !t.includes('곧 끝나는 계약이 없어요'));
    const managed = await page.locator(tid('home-managed')).boundingBox();
    const spending = await page.locator(tid('home-spending')).boundingBox();
    const summary = await page.locator(tid('home-summary')).boundingBox();
    const gap1 = spending.y - (managed.y + managed.height);
    const gap2 = summary.y - (spending.y + spending.height);
    check('E', `두 섹션 모두 없음 → 관리 중 문구 → 지출 → 내 계약이 바로 이어짐 (간격 ${Math.round(gap1)}px · ${Math.round(gap2)}px)`, t.includes('내 계약 1개를 PACTO가 관리하고 있어요') && gap1 < 40 && gap2 < 40);
    await page.screenshot({ path: path.join(SHOTS, 'home-01-empty-sections.png'), fullPage: true });

    // D: 100일 뒤 끝나는 계약 → 곧 종료 섹션
    await lease('곧 끝나는 임대차', kst(-300), kst(100));
    const d = await body();
    check('D', '곧 종료 1건 → "곧 종료·갱신되는 계약" 섹션 + 카드', (await count('home-ends')) === 1 && (await page.locator(tid('home-ends')).innerText()).includes('곧 끝나는 임대차') && (await count('home-actions')) === 0, d);

    // B: 20일 뒤 끝나는 계약 → 지금 확인이 필요한 계약
    await lease('이번 달 끝나는 임대차', kst(-300), kst(20));
    const b = await page.locator(tid('home-actions')).innerText().catch(() => '');
    check('B', '30일 안 일정 1건 → "지금 확인이 필요한 계약 1건" + 카드', b.includes('지금 확인이 필요한 계약 1건') && b.includes('이번 달 끝나는 임대차'), b);
    await page.screenshot({ path: path.join(SHOTS, 'home-02-with-sections.png'), fullPage: true });
  } catch (e) {
    check('X', '예외 없음', false, e.message);
  }
  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
  if (results.some((r) => !r.ok)) process.exit(1);
})();
