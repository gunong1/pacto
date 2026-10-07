/**
 * 기준 시나리오 E2E — 공기청정기 렌탈 (실제 데이터 모드, 월 납입형)
 * 체결 2026-10-05 / 시작 2026-10-12 / 종료 2029-10-11 / 매월 12일 29,900원 + 초기 설치비 20,000원(날짜 없음 → 시작일) / 자동갱신 / 해지 통보 30일 전
 * 날짜는 '-' 없이 입력. 저장 → 캘린더 매핑 → 수정 후 새로고침 없이 반영까지 확인.
 * 사용: BASE_URL=http://localhost:8082 node e2e/rental-scenario.js  (기기 날짜 2026년 10월 기준)
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `rental-${n}.png`) });
  const input = (id) => page.locator(`input${tid(id)}`);

  // 가입
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await input('sign-up-email').fill(`rental-${Date.now()}@pacto.test`);
  await input('sign-up-password').fill('pacto-ui-password-1');
  await input('sign-up-confirm').fill('pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // 직접 입력 (날짜는 숫자만)
  await page.click(tid('first-run-register'));
  await page.click(tid('method-manual'));
  await page.click(tid('type-recurring'));
  await input('field-title').fill('공기청정기 렌탈');
  await page.click(tid('category-rental'));
  await input('field-contractDate').fill('261005');
  await input('field-startDate').click();
  assert((await input('field-contractDate').inputValue()) === '2026-10-05', '6자리 날짜 자동 변환 실패');
  await input('field-startDate').fill('261012');
  await input('field-endDate').fill('20291011');
  assert((await input('field-endDate').inputValue()) === '2029-10-11', '8자리 날짜 즉시 변환 실패');
  assert((await input('field-startDate').inputValue()) === '2026-10-12', '시작일 변환 실패');
  log('날짜 숫자 입력 → 자동 변환 (261005 → 2026-10-05, 20291011 → 2029-10-11)');

  // 잘못된 날짜 검증
  await input('field-contractDate').fill('260229');
  await input('field-startDate').click();
  await page.waitForSelector('text=올바른 날짜가 아니에요', { timeout: 5000 });
  log('없는 날짜(260229) → 오류 표시');
  await input('field-contractDate').fill('261005');

  // 결제 2건: 월 렌탈료(매월 12일) + 초기 설치비(일시불, 날짜 비움 → 계약 시작일)
  await page.click(tid('add-payment'));
  await input('payment-0-label').fill('월 렌탈료');
  await input('payment-0-amount').fill('29900');
  await input('payment-0-dayOfMonth').fill('12');
  await page.click(tid('add-payment'));
  await page.click(tid('payment-1-kind-setup_fee'));
  await input('payment-1-label').fill('초기 설치비');
  await input('payment-1-amount').fill('20000');
  assert((await input('payment-1-dayOfMonth').count()) === 0 && (await input('payment-1-startsOn').count()) === 1, '설치비 기본 주기가 일시불이 아님');
  await page.click(tid('field-autoRenewal'));
  await page.locator('input[aria-label="갱신 주기"]').fill('12');
  await input('field-terminationNoticeDays').fill('30');
  await shot('01-form');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-title'), { timeout: 15000 });
  const detail = await page.locator(tid('contract-detail')).innerText();
  assert(detail.includes('계약 체결일') && detail.includes('2026. 10. 5.'), '상세에 계약 체결일 없음');
  assert(detail.includes('월 렌탈료') && detail.includes('초기 설치비') && detail.includes('해지 통보기한'), '상세 핵심 정보 누락: ' + detail.slice(0, 300));
  log('저장 → 상세: 핵심 정보(월 렌탈료·초기 설치비·자동갱신·해지 통보기한) + 계약 체결일 2026. 10. 5.(기록)');

  // 캘린더 확인
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('tab-calendar'), { timeout: 15000 });
  await page.click(tid('tab-calendar'));
  await page.waitForSelector(tid('calendar-title'));
  assert((await page.locator(tid('calendar-title')).innerText()).includes('10월'), '10월이 아님');
  const label12 = await page.locator(tid('day-2026-10-12')).getAttribute('aria-label');
  assert(label12 && label12.includes('일정 2종'), '10/12 점(색) 2종 표시 아님: ' + label12);
  assert(!(await page.locator(tid('day-2026-10-05')).getAttribute('aria-label')).includes('일정'), '체결일에 이벤트가 생김');
  await page.click(tid('day-2026-10-12'));
  const day12 = await page.locator(tid('calendar-day-list')).innerText();
  assert(day12.includes('이용 시작') && day12.includes('월 렌탈료') && day12.includes('29,900원') && day12.includes('초기 설치비') && day12.includes('20,000원'), '10/12 리스트: ' + day12);
  const total = await page.locator(tid('calendar-month-total')).innerText();
  assert(total.includes('₩49,900'), '10월 지출이 49,900원이 아님: ' + total);
  await shot('02-calendar-oct12');
  log('10/12: 이용 시작 + 월 렌탈료 29,900원 + 초기 설치비 20,000원 (점 2색, 목록 3줄), 10월 지출 ₩49,900');

  await page.click(tid('calendar-next'));
  await page.click(tid('day-2026-11-12'));
  assert((await page.locator(tid('calendar-day-list')).innerText()).includes('월 렌탈료'), '11/12 결제 없음');
  await page.click(tid('calendar-next'));
  await page.click(tid('day-2026-12-12'));
  assert((await page.locator(tid('calendar-day-list')).innerText()).includes('월 렌탈료'), '12/12 결제 없음');
  log('11/12, 12/12: 월 렌탈료');

  for (let i = 0; i < 33; i++) await page.click(tid('calendar-next')); // → 2029년 9월
  assert((await page.locator(tid('calendar-title')).innerText()).includes('2029년 9월'), '2029년 9월 이동 실패');
  await page.click(tid('day-2029-09-11'));
  assert((await page.locator(tid('calendar-day-list')).innerText()).includes('해지 통보기한'), '2029-09-11 해지 통보기한 없음');
  await page.click(tid('calendar-next'));
  await page.click(tid('day-2029-10-11'));
  const end = await page.locator(tid('calendar-day-list')).innerText();
  assert(end.includes('이용 종료') && end.includes('자동갱신'), '2029-10-11 종료/갱신 없음: ' + end);
  await shot('03-calendar-2029-10');
  log('2029-09-11 해지 통보기한, 2029-10-11 이용 종료(자동갱신 조건)');

  // 알림: 같은 계약·같은 알림 날짜는 하나로, 반복 결제는 가장 가까운 것만 + "이후 매월 11일", 알림 날짜와 결제일 구분
  await page.click(tid('tab-home'));
  await page.click(tid('open-notifications'));
  await page.waitForSelector(tid('reminder-list'));
  const notes = await page.locator(tid('reminder-list')).innerText();
  assert(notes.includes('공기청정기 렌탈 · 결제') && notes.includes('내일 49,900원 결제 예정이에요.'), '10/11 통합 알림 없음: ' + notes);
  assert(notes.includes('월 렌탈료 29,900원 · 초기 설치비 20,000원'), '세부 내역 없음: ' + notes);
  assert(notes.includes('일정 · 10월 12일 월 렌탈료 · 초기 설치비 결제') && notes.includes('10월 11일') && notes.includes('알림 예정'), '알림 날짜/결제일 구분 없음: ' + notes);
  assert(notes.includes('이후 매월 11일 알림 예정'), '반복 알림 요약 없음: ' + notes);
  assert((notes.match(/공기청정기 렌탈 · /g) || []).length === 1, '같은 계약 알림이 여러 줄: ' + notes);
  assert(!notes.includes('해지 통보기한'), '60일 안에 해지 통보기한 알림이 있으면 안 됨: ' + notes);
  await shot('04-notifications');
  log('알림: 10/11 알림 1개(내일 49,900원 결제 예정 · 월 렌탈료+설치비), 결제일 10/12 따로 표시, 이후 매월 11일, 해지 통보기한 없음');
  await page.goBack();

  // 수정: 시작일 10/12 → 10/15 → 새로고침 없이 캘린더 반영
  await page.click(tid('tab-contracts'));
  await page.locator(`${tid('contracts-list')} >> text=공기청정기 렌탈`).click();
  await page.click(tid('edit-contract'));
  await input('field-startDate').fill('261015');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-title'));
  await page.waitForTimeout(500);
  await page.goBack(); // 상세 → 계약 목록 (같은 화면 세션, 새로고침 없음)
  await page.waitForSelector(tid('tab-calendar'), { timeout: 15000 });
  await page.click(tid('tab-calendar'));
  for (let i = 0; i < 40 && !(await page.locator(tid('calendar-title')).innerText()).includes('2026년 10월'); i++) await page.click(tid('calendar-prev'));
  const l12 = (await page.locator(tid('day-2026-10-12')).getAttribute('aria-label')) || '';
  const l15 = (await page.locator(tid('day-2026-10-15')).getAttribute('aria-label')) || '';
  assert(!l12.includes('일정') && l15.includes('일정 2종'), `수정 반영 실패 12=${l12} 15=${l15}`);
  const total2 = await page.locator(tid('calendar-month-total')).innerText();
  assert(total2.includes('₩20,000'), '시작일 변경 후 10월 지출: ' + total2);
  log('시작일 10/15로 수정 → 새로고침 없이 반영 (10/12 비움, 10/15 이용 시작 + 설치비, 첫 렌탈료 11/12 → 10월 ₩20,000)');

  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
