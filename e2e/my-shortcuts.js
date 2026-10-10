/**
 * MY 상단 통계 바로가기 — "보관 중인 계약" → 계약 탭(전체), "보관 문서 N개" → 보관 문서 목록 (같은 "문서 개수" 기준, N개 = 목록 N줄)
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
  await page.waitForSelector(tid('my-stat-documents'));
  const myCount = Number((await page.locator(tid('my-stat-documents')).innerText()).match(/(\d+)개/)[1]);
  await page.click(tid('my-stat-documents'));
  await page.waitForSelector(tid('documents-screen'));
  await page.waitForTimeout(400);
  const docRows = await page.locator('[data-testid^="document-row-"]').count();
  const groups = await page.locator('[data-testid^="documents-group-"]').count();
  const summary = await page.locator(tid('documents-summary')).innerText();
  check(`보관 문서 ${myCount}개 → 문서 목록 ${docRows}줄 (같은 기준)`, myCount > 0 && docRows === myCount);
  check(`요약: 문서 ${docRows}개 · 계약 ${groups}건 (문서 수와 계약 수를 나눠 표시)`, summary === `문서 ${docRows}개 · 계약 ${groups}건`);
  check('계약 필터 화면이 아니라 문서 목록 화면 (/documents)', page.url().endsWith('/documents') && (await page.locator(`${tid('filter-docs-clear')}:visible`).count()) === 0);
  const firstGroup = await page.locator(tid('documents-group-0')).innerText();
  await page.locator(tid('documents-group-0')).getByText('계약 보기').click();
  await page.waitForSelector(tid('detail-core'), { timeout: 10000 });
  check('"계약 보기" → 그 계약 상세', firstGroup.length > 0);
  await page.goBack();
  await page.waitForSelector(tid('documents-screen'));
  // 웹은 계약서 상세의 "계약서 보기"와 같이 새 탭으로 연다 (미리보기 문서는 파일이 없어 안내)
  const opened = await Promise.race([
    page.context().waitForEvent('page', { timeout: 8000 }).then(() => 'tab'),
    page.waitForEvent('dialog', { timeout: 8000 }).then((d) => (d.accept().catch(() => undefined), 'dialog')),
    page.locator('[data-testid^="document-row-"]').first().click().then(() => new Promise(() => undefined)),
  ]).catch(() => 'none');
  check(`문서 누르면 계약서 보기와 같은 방식으로 열기 (${opened})`, opened === 'tab' || opened === 'dialog');
  for (const p of page.context().pages()) if (p !== page) await p.close();
  await page.goBack();
  await page.waitForSelector(tid('tab-my'), { state: 'visible' });

  await page.click(tid('tab-my'));
  await page.click(tid('my-stat-contracts'));
  await page.waitForTimeout(400);
  check('"보관 중인 계약" → 필터 없이 전체', (await rows()) === all && (await chip()) === 0);
  check('페이지 오류 없음', errors.length === 0);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
