/**
 * V1 완료 기준 시나리오 E2E (로컬 Supabase + 실제 데이터 모드 웹 미리보기)
 * 회원가입 → 계약 등록(PDF) → DB 저장 → 원본 파일 보관 → 앱 재실행 → 계약 다시 확인 → 원본 계약서 열람
 * 사용: BASE_URL=http://localhost:8082 node e2e/wallet-flow.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `wallet-${n}.png`) });

  // 1. 회원가입
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `wallet-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
  log('1 회원가입');

  // 2. 계약 등록 (PDF)
  await page.click(tid('first-run-register'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '공기청정기_렌탈계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector('text=계약서를 안전하게 보관하고 있어요.', { timeout: 10000 }).catch(() => undefined);
  await page.waitForSelector(tid('submit-contract'), { timeout: 20000 });
  await shot('01-review');
  log('2 PDF 업로드 → 원본 보관 → 자동 정리 결과 확인 화면');

  // 3. DB 저장
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-open-original'), { timeout: 15000 });
  const title = await page.locator(tid('detail-title')).innerText();
  log('3 저장 → 상세:', title, '/ "계약서 원본 보기" 표시');

  // 4~5. 앱 재실행 → 계약 다시 확인
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'), { timeout: 15000 });
  await page.click(tid('tab-contracts'));
  const row = page.locator(`${tid('contracts-list')} >> text=${title}`);
  await row.waitFor({ timeout: 15000 });
  await row.click();
  await page.waitForSelector(tid('detail-open-original'), { timeout: 15000 });
  await shot('02-detail-after-reload');
  log('4~5 새로고침(재실행) 후 계약·원본 연결 유지');

  // 6. 원본 계약서 열람 (Signed URL)
  // 헤드리스 브라우저는 PDF를 다운로드로 처리하므로, 새 탭이 요청한 Signed URL을 확인한다
  const [request] = await Promise.all([
    context.waitForEvent('request', { predicate: (r) => r.method() === 'GET' && r.url().includes('/storage/v1/object/sign/contract-files/') && r.url().includes('token='), timeout: 15000 }),
    page.click(tid('detail-open-original')),
  ]);
  const signedUrl = request.url();
  const res = await context.request.get(signedUrl);
  const body = await res.body();
  if (res.status() !== 200 || !body.equals(PDF)) throw new Error(`원본 열람 실패 status=${res.status()} ${body.toString().slice(0, 200)} url=${signedUrl.slice(0, 160)}`);
  log('6 원본 계약서 열람: Signed URL 200, 업로드한 파일과 동일', `(${new URL(signedUrl).pathname.split('/').slice(0, 7).join('/')}/…)`);
  if (!/token=/.test(signedUrl)) throw new Error('Signed URL이 아님');
  for (const p of context.pages()) if (p !== page) await p.close();

  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
