/**
 * Step 4 완료 기준 흐름(10단계)을 웹 미리보기에서 검증하는 E2E 스크립트.
 * 사용: `npm run web` 실행 후 `node e2e/web-flow.js`
 * (playwright가 프로젝트 의존성이 아니면 PLAYWRIGHT_MODULE=<경로>로 지정)
 * 날짜 의존: 2026년 10월 기준 mock 데이터로 작성 (10/12 결제 확인 등).
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const shot = (n, full = false) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: full });
  const total = async () => (await page.locator(tid('home-spending-total')).innerText()).trim();

  // 1. 앱 실행
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('signin-apple'));
  await shot('01-welcome');
  log('1 앱 실행 → 시작 화면');

  // 2. 홈
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));
  const before = await total();
  await shot('02-home');
  const attention = await page.locator(tid('home-actions')).innerText();
  if (!attention.includes('지금 확인이 필요한 계약')) throw new Error('홈 확인 필요 영역 없음');
  log('2 홈 확인, 이번 달 지출 =', before, '/', attention.split('\n').find((l) => l.includes('확인이 필요한')));

  // 3. 계약 목록
  await page.click(tid('tab-contracts'));
  await page.waitForSelector(tid('contract-row-c-gym'));
  await shot('03-contracts');
  log('3 계약 목록');

  // 4. 계약 상세
  await page.click(tid('contract-row-c-gym'));
  await page.waitForSelector(tid('detail-title'));
  await page.waitForTimeout(400);
  await shot('04-detail-gym');
  const headline = await page.locator(tid('detail-next-headline')).innerText();
  if (headline !== '해지 통보기한이 57일 남았습니다.') throw new Error('다음 행동 불일치: ' + headline);
  log('4 계약 상세:', await page.locator(tid('detail-title')).innerText(), '/ 다음 행동:', headline);
  await page.click(tid('detail-open-calendar'));
  await page.waitForSelector(tid('calendar-day-list'));
  await page.waitForTimeout(300);
  const dayTitle = await page.locator(tid('calendar-day-list')).innerText();
  if (!dayTitle.includes('2026. 12. 1.') || !dayTitle.includes('해지 통보기한')) throw new Error('캘린더 보기 이동 실패: ' + dayTitle.slice(0, 80));
  await shot('04b-calendar-from-detail');
  log('4 다음 행동 → 캘린더 보기: 12/1 해지 통보기한 표시');
  await page.click(tid('tab-contracts'));
  await page.waitForSelector(tid('contracts-list'));

  // 5. 계약 등록
  await page.click(tid('tab-add'));
  await page.waitForSelector(tid('method-pdf'));
  await shot('05-register');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: 'sample-contract.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%mock\n') });
  await page.waitForSelector('text=계약서를 확인하고 있어요.');
  await shot('06-analyzing');
  log('5 계약 등록 → 분석 화면');

  // 6. AI mock 결과 확인/수정
  await page.waitForSelector(tid('submit-contract'), { timeout: 15000 });
  await page.waitForTimeout(300);
  await shot('07-review', true);
  const day = page.locator(`input${tid('field-paymentDay')}`);
  await day.fill('12');
  await page.waitForTimeout(200);
  log('6 확인 화면: 결제일 10 → 12 수정');

  // 7. 계약 저장
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-title'), { timeout: 10000 });
  await page.waitForTimeout(400);
  const savedTitle = await page.locator(tid('detail-title')).innerText();
  await shot('08-saved-detail');
  log('7 저장 → 상세:', savedTitle);

  // 8. 홈/목록 반영
  await page.goBack();
  await page.waitForTimeout(500);
  if (!(await page.locator(tid('tab-home')).isVisible())) await page.goBack();
  await page.click(tid('tab-home'));
  await page.waitForSelector(tid('home-spending-total'));
  await page.waitForTimeout(400);
  const after = await total();
  await shot('09-home-after');
  const n = (s) => Number((/₩([\d,]+)/.exec(s)?.[1] ?? s).replace(/[^\d]/g, ''));
  if (n(after) - n(before) !== 29900) throw new Error(`지출 반영 실패 ${before} → ${after}`);
  if (!(await page.locator(tid('home-recent')).innerText()).includes('공기청정기 렌탈')) throw new Error('최근 등록 미반영');
  log('8 홈 반영: 지출', before, '→', after, '/ 최근 등록에 표시');
  await page.click(tid('tab-contracts'));
  await page.waitForTimeout(400);
  if (!(await page.locator(tid('contracts-list')).innerText()).includes('공기청정기 렌탈')) throw new Error('목록 미반영');
  log('8 계약 목록 반영');

  // 9. 캘린더 반영
  await page.click(tid('tab-calendar'));
  await page.waitForSelector(tid('calendar-title'));
  for (let i = 0; i < 12 && !(await page.locator(tid('calendar-title')).innerText()).includes('10월'); i++) await page.click(tid('calendar-prev'));
  await page.click(tid('day-2026-10-12'));
  await page.waitForTimeout(300);
  const dayList = await page.locator(tid('calendar-day-list')).innerText();
  if (!dayList.includes('공기청정기 렌탈')) throw new Error('캘린더 미반영: ' + dayList);
  await shot('10-calendar');
  log('9 캘린더 10/12에 렌탈료 결제 표시');

  // 10. 월 지출(캘린더 합계) 반영
  const monthTotal = await page.locator(tid('calendar-month-total')).innerText();
  if (n(monthTotal) !== n(after)) throw new Error(`캘린더 월 합계 불일치 ${monthTotal} vs ${after}`);
  log('10 월 지출 반영:', monthTotal.replace(/\n/g, ' '));

  // 추가 화면
  await page.click(tid('tab-home'));
  await page.click(tid('open-notifications'));
  await page.waitForSelector(tid('reminder-list'));
  await page.waitForTimeout(300);
  await shot('11-notifications');
  await page.goBack();
  await page.click(tid('tab-my'));
  await page.waitForTimeout(400);
  await shot('12-my');

  console.log('\nconsole/page errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(async (e) => {
  console.error('✘', e.message);
  process.exit(1);
});
