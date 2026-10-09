/**
 * MY 상단 통계 바로가기 — "보관 중인 계약" → 계약 탭(전체), "보관 문서" → 보관 문서가 있는 계약만 (해제 가능)
 * 사용: `npm run web`(mock 모드) 실행 후 `node e2e/my-shortcuts.js`
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const tid = (id) => `[data-testid="${id}"]`;
const check = (name, ok) => {
  console.log(`${ok ? '✔' : '✘'} ${name}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const rows = () => page.locator('[data-testid^="contract-row-"]').count();
  const chip = () => page.locator(tid('filter-docs-clear')).count();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.click(tid('tab-my'));
  await page.waitForSelector(tid('my-stat-documents'));
  check('"보관 문서" 표기 (원본 계약서 아님)', (await page.locator(tid('my-stat-documents')).innerText()).includes('보관 문서'));

  await page.click(tid('my-stat-contracts'));
  await page.waitForSelector(tid('contracts-list'));
  await page.waitForTimeout(400);
  const all = await rows();
  check(`보관 중인 계약 → 계약 탭 전체 (${all}건, 문서 필터 없음)`, all > 0 && (await chip()) === 0);

  await page.click(tid('tab-my'));
  await page.click(tid('my-stat-documents'));
  await page.waitForTimeout(500);
  const withDocs = await rows();
  check(`보관 문서 → 문서 있는 계약만 (${withDocs}건 < ${all}건, 필터 표시)`, withDocs > 0 && withDocs < all && (await chip()) === 1);

  await page.click(tid('filter-docs-clear'));
  await page.waitForTimeout(300);
  check('필터 해제 → 전체로', (await rows()) === all);

  await page.click(tid('tab-my'));
  await page.click(tid('my-stat-documents'));
  await page.waitForTimeout(400);
  await page.click(tid('tab-my'));
  await page.click(tid('my-stat-contracts'));
  await page.waitForTimeout(400);
  check('문서 필터 상태에서 "보관 중인 계약" → 필터 풀림', (await rows()) === all && (await chip()) === 0);
  check('페이지 오류 없음', errors.length === 0);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
