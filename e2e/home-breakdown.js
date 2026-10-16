/**
 * 홈 월별 출금 요약 계층 + 중복 등록 안내 (실제 데이터 모드 + 서버 mock 임대차, 모든 값은 가짜)
 * A 임대차(임차인) 등록 → 홈 10월: 총 출금 ₩20,950,000 > 계약별 줄: 보증금 20,000,000 · 월세 등 950,000 (같은 계약도 보증금 줄은 따로)
 *   줄의 합 = 총액 · 반복 안내 문구 없음 · 캘린더와 같은 총액
 * B 같은 계약서를 한 번 더 등록 → "같은 계약이 2번 등록된 것 같아요" · 합계는 둘 다 포함(₩41,900,000) · 두 계약 링크
 * C "중복 아니에요" → 안내 숨김 → 앱 다시 열어도 숨김 · 합계 그대로
 * 사용: BASE_URL=http://localhost:8082 node e2e/home-breakdown.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (no, name, ok, detail = '') => {
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, !ok && detail ? `— ${String(detail).slice(0, 400)}` : '');
  if (!ok) process.exitCode = 1;
};
const PDF = require('./cleanPdf')();

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  let page = await context.newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept().catch(() => undefined));
  };
  watch(page);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `home-breakdown-${n}.png`), fullPage: true });
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  const count = (id) => page.locator(tid(id)).count();
  const home = async () => {
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('home-spending-total'));
    await page.waitForTimeout(500);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `home-breakdown-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  const register = async () => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
    await chooser.setFiles({ name: '주택_임대차_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.waitForSelector(tid('role-question'), { timeout: 30000 });
    if (await count('contract-name-skip')) {
      await page.click(tid('contract-name-skip'));
      await page.waitForTimeout(800);
    }
    await page.click(tid('role-option-p1'));
    if (await count('role-preview')) await page.click(tid('role-apply'));
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  };

  // A
  await register();
  await home();
  const total = await text('home-spending-total');
  const split = await text('home-spending-lines');
  const won = (t) => [...t.matchAll(/₩([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  check('A1', '총 출금 ₩20,950,000', total.includes('20,950,000'), total);
  check('A2', '계약별 줄: 보증금 20,000,000 (보증금 표시) · 950,000 · 반복 안내 없음', (await text('home-spending-line-0')).includes('20,000,000') && (await text('home-spending-line-0')).includes('보증금') && split.includes('950,000') && !(await text('home-spending')).includes('모두 총 출금 예정에 포함'), split);
  check('A3', '줄의 합 = 총액 (20,950,000)', won(split).reduce((a, b) => a + b, 0) === 20_950_000, split);
  check('A5', '중복 안내 없음 (계약 하나)', (await count('home-duplicates')) === 0);
  await shot('01-one');
  await page.goto(`${BASE}/calendar?date=2026-10-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  check('A6', '캘린더 10월 총 출금 ₩20,950,000 (홈과 같음)', (await page.locator(tid('calendar-month-total')).getAttribute('aria-label')).includes('₩20,950,000'));

  // B
  await register();
  await home();
  const t2 = await text('home-spending-total');
  check('B1', '같은 계약서를 다시 등록해도 합계에서 빼지 않음: ₩41,900,000', t2.includes('41,900,000'), t2);
  const dup = (await count('home-duplicate')) ? await text('home-duplicate') : '';
  check('B2', '"같은 계약이 2번 등록된 것 같아요" + 두 계약 링크 + 중복 아니에요', dup.includes('같은 계약이 2번 등록된 것 같아요') && (await count('home-duplicate-open-0')) === 1 && (await count('home-duplicate-open-1')) === 1 && dup.includes('중복 아니에요'), dup);
  const lines2 = await text('home-spending-lines');
  check('B3', '같은 이름 계약 2개도 따로 줄 (3줄 + 외 1건)', (await count('home-spending-line-2')) === 1 && (await text('home-spending-more')).includes('외 1건'), lines2);
  await shot('02-duplicate');

  // C
  await page.click(tid('home-duplicate-dismiss'));
  await page.waitForTimeout(500);
  check('C1', '"중복 아니에요" → 안내 숨김', (await count('home-duplicate')) === 0);
  await page.close();
  page = await context.newPage();
  watch(page);
  await home();
  check('C2', '앱 다시 열어도 숨김 · 합계 그대로', (await count('home-duplicate')) === 0 && (await text('home-spending-total')).includes('41,900,000'));

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
