/**
 * 알림 화면 — 중요한 계약 일정(출처 구분) + 다음 알림
 * 직접 입력한 월세 계약: 만기 2027-08-20, 종료 통보 60일 전(=2027-06-21), 월세 매월 20일 850,000원
 * 기대: 종료 통보기한 카드 = "입력한 계약 정보 기준"(critical, 계약서 기준 아님) / 갱신 여부 확인 = "PACTO 안내"(critical 아님)
 * 사용: BASE_URL=http://localhost:8082 node e2e/important-notifications.js  (기기 날짜 2026년 10월 기준)
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`important-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

    // 직접 입력 (계약서 업로드 없음)
    await page.click(tid('first-run-register'));
    await page.click(tid('method-manual'));
    await page.click(tid('toggle-more')); // 직접 입력: 접힌 상세 정보 펼치기
    await page.click(tid('type-lease'));
    await input('field-title').fill('주택 임대차계약');
    await page.click(tid('category-real_estate'));
    await input('field-startDate').fill('250821');
    await input('field-endDate').fill('270820');
    await page.click(tid('detail-leaseKind-monthly'));
    await page.click(tid('add-payment'));
    await page.click(tid('payment-0-kind-rent'));
    await page.click(tid('payment-0-frequency-monthly'));
    await input('payment-0-label').fill('월세');
    await input('payment-0-amount').fill('850000');
    await input('payment-0-dayOfMonth').fill('20');
    await input('field-terminationNoticeDays').fill('60');
    await page.click(tid('notice-kind-termination_notice'));
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    log('직접 입력: 월세 계약 (만기 2027-08-20, 종료 통보 60일 전)');

    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('important-list'), { timeout: 15000 });
    const imp = await page.locator(tid('important-list')).innerText();
    assert(imp.includes('종료 통보기한이 다가와요') && imp.includes('주택 임대차계약'), '종료 통보기한 카드 없음: ' + imp);
    assert(imp.includes('입력한 계약 정보 기준'), '직접 입력 출처 문구 없음: ' + imp);
    assert(!imp.includes('계약서 기준'), '직접 입력한 계약에 "계약서 기준"이 있으면 안 됨: ' + imp);
    assert(imp.includes('중요') && imp.includes('2027. 6. 21.'), '중요 라벨/기한 날짜 없음: ' + imp);
    assert(!imp.includes('미리 알려드려요.') || imp.includes('PACTO 안내'), '카드에 알림 발송 시점이 적히면 안 됨 (설정 요약에서): ' + imp);
    assert(imp.includes('갱신 여부를 미리 확인해보세요') && imp.includes('PACTO 안내'), 'PACTO 안내 카드 없음: ' + imp);
    assert(imp.includes('계약서나 법령에 정해진 기한이 아니라'), 'PACTO 안내 설명 없음: ' + imp);
    assert(!imp.includes('법령 기준'), '법령 기준 알림이 있으면 안 됨: ' + imp);
    const order = imp.indexOf('종료 통보기한이 다가와요') < imp.indexOf('갱신 여부를 미리 확인해보세요');
    assert(order, 'critical이 먼저가 아님');
    log('중요한 계약 일정: 종료 통보기한(중요·입력한 계약 정보 기준·2027. 6. 21.) → 갱신 여부 확인(PACTO 안내, 법령·계약서 기한 아님)');

    const policy = await page.locator(tid('reminder-policy')).innerText();
    assert(policy.includes('알림 설정') && policy.includes('오전 9:00 · 주요 계약 알림 사용 중') && policy.includes('설정 변경'), '알림 설정 요약 없음: ' + policy);
    assert(!policy.includes('30·7·1일 전') && !policy.includes('해지·갱신 통보기한') && !policy.includes('기한 자체는'), '알림 화면에 종류별 시점이 나열됨: ' + policy);
    const whole = await page.locator('body').innerText();
    assert(!whole.includes('다음 알림') && !whole.includes('850,000원 결제 예정'), '미래 푸시 목록이 남아 있음: ' + whole);
    log('알림 설정 요약 한 줄 (오전 9:00 · 주요 계약 알림 사용 중, 종류별 시점 나열 없음) · 미래 푸시 목록 없음 · 일반 월세 결제는 중요 일정에 없음');
    await page.waitForSelector(tid('brand-splash'), { state: 'detached', timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector(tid('brand-splash-leaving'), { state: 'detached', timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(SHOTS, 'important-01-notifications.png'), fullPage: true });

    // 캘린더도 같은 중요도·출처
    await page.goto(`${BASE}/calendar?date=2027-06-21&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
    const cal = await page.locator(tid('calendar-day-list')).innerText();
    assert(cal.includes('종료 통보기한') && cal.includes('중요') && cal.includes('입력한 계약 정보 기준'), '캘린더 중요 표시 없음: ' + cal);
    assert(cal.includes('갱신 여부 확인 (PACTO 안내)'), '캘린더 PACTO 안내 출처 없음: ' + cal);
    await page.screenshot({ path: path.join(SHOTS, 'important-02-calendar-0621.png') });
    log('캘린더 6/21: 종료 통보기한(중요 · 입력한 계약 정보 기준) + 갱신 여부 확인');
  } catch (e) {
    console.log('✘', e.message);
    await page.screenshot({ path: path.join(SHOTS, 'important-error.png'), fullPage: true });
    process.exitCode = 1;
  }
  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})();
