/**
 * Step 7~8 실제 데이터 E2E (로컬 Supabase + EXPO_PUBLIC_SUPABASE_* 설정한 웹 미리보기)
 * 가입 → 계약 등록 → DB 저장 → (새로고침 = 앱 재실행) → 계약 다시 확인 → 수정 → 일정 → 삭제
 * 사용: BASE_URL=http://localhost:8082 node e2e/supabase-flow.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, `sb-${n}.png`) });

async function signUp(page, email, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, email);
  await page.fill(`input${tid('sign-up-password')}`, password);
  await page.fill(`input${tid('sign-up-confirm')}`, password);
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());

  await signUp(page, `crud-${Date.now()}@pacto.test`, 'pacto-ui-password-1');
  await page.waitForTimeout(500);
  await shot(page, '01-empty-home');
  log('가입 → 빈 홈');

  // 직접 입력으로 계약 등록
  await page.click(tid('first-run-register'));
  await page.click(tid('method-manual'));
  await page.fill(`input${tid('field-title')}`, '헬스장');
  await page.click(tid('type-recurring'));
  await page.click(tid('category-membership'));
  await page.fill(`input${tid('field-startDate')}`, '260101');
  await page.fill(`input${tid('field-endDate')}`, '20261231');
  await page.click(tid('add-payment'));
  await page.fill(`input${tid('payment-0-label')}`, '월 회비');
  await page.fill(`input${tid('payment-0-amount')}`, '55000');
  await page.fill(`input${tid('payment-0-dayOfMonth')}`, '5');
  await page.click(tid('field-autoRenewal'));
  await page.fill('input[aria-label="갱신 주기"]', '12');
  await page.fill(`input${tid('field-terminationNoticeDays')}`, '30');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-next-headline'), { timeout: 15000 });
  const headline = await page.locator(tid('detail-next-headline')).innerText();
  log('직접 입력 저장 → 상세, 다음 행동:', headline);
  const url = page.url();

  // 앱 재실행(새로고침) 후 계약 유지
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const total = await page.locator(tid('home-spending-total')).innerText();
  if (!total.includes('55,000')) throw new Error('재실행 후 지출 미반영: ' + total);
  await shot(page, '02-home-after-reload');
  log('새로고침(재실행) 후 홈 지출 유지:', total);

  await page.click(tid('tab-contracts'));
  const row = page.locator(`${tid('contracts-list')} >> text=헬스장`);
  await row.waitFor();
  await row.click();
  await page.waitForSelector(tid('detail-title'));
  log('계약 다시 확인');

  // 수정
  await page.click(tid('edit-contract'));
  await page.fill(`input${tid('payment-0-amount')}`, '60000');
  await page.click(tid('submit-contract'));
  await page.locator(`${tid('contract-detail')} >> text=60,000원`).first().waitFor({ timeout: 15000 });
  log('계약 수정 → 60,000원');

  // 일정 추가 → 수정 → 삭제
  await page.locator(`${tid('detail-schedule')} >> text=일정 추가`).click();
  await page.fill(`input${tid('event-title')}`, '해지 신청서 제출');
  await page.fill(`input${tid('event-date')}`, '2026-11-20');
  await page.click(tid('save-event'));
  const ev1 = page.locator(`${tid('detail-schedule')} >> text=해지 신청서 제출`);
  await ev1.waitFor({ timeout: 15000 });
  await ev1.click();
  await page.fill(`input${tid('event-title')}`, '해지 신청서 방문 제출');
  await page.click(tid('save-event'));
  const ev2 = page.locator(`${tid('detail-schedule')} >> text=해지 신청서 방문 제출`);
  await ev2.waitFor({ timeout: 15000 });
  await ev2.click();
  await page.click(tid('delete-event'));
  await page.waitForSelector(tid('detail-title'));
  await page.waitForTimeout(800);
  if (await page.locator(`${tid('detail-schedule')} >> text=해지 신청서 방문 제출`).count()) throw new Error('일정 삭제 실패');
  log('일정 추가 → 수정 → 삭제');

  // 계약 삭제
  await page.click(tid('delete-contract'));
  await page.waitForSelector(tid('contracts-list'), { timeout: 15000 });
  await page.waitForTimeout(800);
  if (await page.locator(`${tid('contracts-list')} >> text=헬스장`).count()) throw new Error('계약 삭제 실패');
  log('계약 삭제');
  void url;

  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
