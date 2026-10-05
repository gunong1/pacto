/**
 * Step 6 인증 E2E (실제 Supabase — 로컬 스택 + EXPO_PUBLIC_SUPABASE_* 설정한 웹 미리보기)
 * 사용: BASE_URL=http://localhost:8082 node e2e/auth-flow.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const email = `ui-${Date.now()}@pacto.test`;
  const password = 'pacto-ui-password-1';

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, email);
  await page.fill(`input${tid('sign-up-password')}`, password);
  await page.fill(`input${tid('sign-up-confirm')}`, password);
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('sign-up-error'));
  log('필수 동의 없이 가입 불가:', await page.locator(tid('sign-up-error')).innerText());
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-actions'), { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, 'auth-01-home-after-signup.png') });
  log('가입 → 홈');

  // 새로고침해도 로그인 유지 (세션 복원)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-actions'), { timeout: 15000 });
  log('새로고침 후 세션 유지');

  await page.click(tid('tab-my'));
  await page.waitForSelector(`text=${email}`);
  await page.click(tid('sign-out'));
  await page.waitForSelector(tid('signin-email'));
  log('로그아웃 → 시작 화면');

  await page.click(tid('signin-email'));
  await page.fill(`input${tid('sign-in-email')}`, email);
  await page.fill(`input${tid('sign-in-password')}`, 'wrong-password-1');
  await page.click(tid('sign-in-submit'));
  await page.waitForSelector('text=이메일 또는 비밀번호가 올바르지 않아요.');
  log('잘못된 비밀번호 안내');
  await page.fill(`input${tid('sign-in-password')}`, password);
  await page.click(tid('sign-in-submit'));
  await page.waitForSelector(tid('home-actions'), { timeout: 15000 });
  log('로그인 → 홈');

  await page.click(tid('tab-my'));
  await page.click(tid('open-delete-account'));
  await page.waitForSelector(tid('delete-account-agree'));
  await page.screenshot({ path: path.join(SHOTS, 'auth-02-delete-account.png') });
  await page.click(tid('delete-account-agree'));
  await page.click(tid('delete-account-submit'));
  await page.waitForSelector(tid('signin-email'), { timeout: 20000 });
  log('회원 탈퇴 → 시작 화면');

  await page.click(tid('signin-email'));
  await page.fill(`input${tid('sign-in-email')}`, email);
  await page.fill(`input${tid('sign-in-password')}`, password);
  await page.click(tid('sign-in-submit'));
  await page.waitForSelector('text=이메일 또는 비밀번호가 올바르지 않아요.');
  log('탈퇴한 계정으로 로그인 불가');

  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
