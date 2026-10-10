/**
 * 알림 화면 — 알림 구간에 들어온 중요한 계약 일정만 (Push와 같은 알림 규칙) · 출처 구분
 * ① 먼 계약: 만기 2027-08-20, 종료 통보 60일 전(=2027-06-21) → 알림 화면에는 없음(D-250 안팎), 캘린더에는 그대로
 * ② 가까운 계약: 만기 오늘+50일, 종료 통보 30일 전(=오늘+20일) → 통보기한(알림 30일 전 구간)·만기(90일 전 구간) 카드 표시
 *    통보기한 카드 = "입력한 계약 정보 기준"(critical, 계약서 기준 아님) · PACTO 안내는 Push 알림이 아니므로 알림 화면에 없음
 * 사용: BASE_URL=http://localhost:8082 node e2e/important-notifications.js  (기기 날짜 2026년 10월 기준)
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
/** 오늘(한국 시간) + n일 → YYMMDD 입력 / "YYYY. M. D." 표시 */
const kstDate = (n) => new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
const yymmdd = (n) => {
  const d = kstDate(n);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};
const dotted = (n) => {
  const d = kstDate(n);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
};
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
    const lease = async (title, start, end, notice) => {
      await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
      await page.click(tid('method-manual'));
      await page.click(tid('toggle-more')); // 직접 입력: 접힌 상세 정보 펼치기
      await page.click(tid('type-lease'));
      await input('field-title').fill(title);
      await page.click(tid('category-real_estate'));
      await input('field-startDate').fill(start);
      await input('field-endDate').fill(end);
      await page.click(tid('detail-leaseKind-monthly'));
      await page.click(tid('add-payment'));
      await page.click(tid('payment-0-kind-rent'));
      await page.click(tid('payment-0-frequency-monthly'));
      await input('payment-0-label').fill('월세');
      await input('payment-0-amount').fill('850000');
      await input('payment-0-dayOfMonth').fill('20');
      await input('field-terminationNoticeDays').fill(notice);
      await page.click(tid('notice-kind-termination_notice'));
      await page.click(tid('submit-contract'));
      await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    };
    await lease('주택 임대차계약', '250821', '270820', '60');
    log('① 먼 계약: 만기 2027-08-20, 종료 통보 60일 전(2027-06-21)');

    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('important-list'), { timeout: 15000 });
    const far = await page.locator(tid('important-list')).innerText();
    assert(!far.includes('주택 임대차계약') && !far.includes('다가와요') && far.includes('지금 확인할 중요한 계약 일정이 없어요.'), '먼 미래 일정이 알림 화면에 있음: ' + far);
    log('① 알림 화면: 2027년 기한은 아직 알림 시점이 아니라 표시하지 않음 ("지금 확인할 중요한 계약 일정이 없어요.")');

    await lease('오피스텔 임대차', yymmdd(-300), yymmdd(50), '30');
    log(`② 가까운 계약: 만기 ${dotted(50)}, 종료 통보 30일 전(${dotted(20)})`);
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('important-list'), { timeout: 15000 });
    const imp = await page.locator(tid('important-list')).innerText();
    assert(imp.includes('종료 통보기한이 다가와요') && imp.includes('오피스텔 임대차'), '종료 통보기한 카드 없음: ' + imp);
    assert(imp.includes('입력한 계약 정보 기준'), '직접 입력 출처 문구 없음: ' + imp);
    assert(!imp.includes('계약서 기준'), '직접 입력한 계약에 "계약서 기준"이 있으면 안 됨: ' + imp);
    assert(imp.includes('중요') && imp.includes(dotted(20)), '중요 라벨/기한 날짜 없음: ' + imp);
    assert(!imp.includes('주택 임대차계약'), '먼 계약이 함께 나오면 안 됨: ' + imp);
    assert(!imp.includes('PACTO 안내') && !imp.includes('갱신 여부를 미리 확인해보세요'), 'PACTO 안내(Push 아님)가 알림 화면에 있음: ' + imp);
    assert(!imp.includes('법령 기준'), '법령 기준 알림이 있으면 안 됨: ' + imp);
    log(`② 알림 화면: 종료 통보기한(D-20 · 30일 전 알림 구간 · 중요 · 입력한 계약 정보 기준) 표시, 먼 계약·PACTO 안내 없음`);

    const policy = await page.locator(tid('reminder-policy')).innerText();
    assert(policy.includes('알림 설정') && policy.includes('오전 9:00 · 주요 계약 알림 사용 중') && policy.includes('설정 변경'), '알림 설정 요약 없음: ' + policy);
    assert(!policy.includes('30·7·1일 전') && !policy.includes('해지·갱신 통보기한') && !policy.includes('기한 자체는'), '알림 화면에 종류별 시점이 나열됨: ' + policy);
    const whole = await page.locator('body').innerText();
    assert(!whole.includes('다음 알림') && !whole.includes('850,000원 결제 예정'), '미래 푸시 목록이 남아 있음: ' + whole);
    log('알림 설정 요약 한 줄 (오전 9:00 · 주요 계약 알림 사용 중, 종류별 시점 나열 없음) · 미래 푸시 목록 없음 · 일반 월세 결제는 중요 일정에 없음');
    await page.waitForSelector(tid('brand-splash'), { state: 'detached', timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector(tid('brand-splash-leaving'), { state: 'detached', timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(SHOTS, 'important-01-notifications.png'), fullPage: true });

    // 캘린더는 먼 미래 일정도 그대로 (같은 중요도·출처)
    await page.goto(`${BASE}/calendar?date=2027-06-21&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
    const cal = await page.locator(tid('calendar-day-list')).innerText();
    assert(cal.includes('종료 통보기한') && cal.includes('중요') && cal.includes('입력한 계약 정보 기준'), '캘린더 중요 표시 없음: ' + cal);
    assert(cal.includes('갱신 여부 확인 (PACTO 안내)'), '캘린더 PACTO 안내 출처 없음: ' + cal);
    await page.screenshot({ path: path.join(SHOTS, 'important-02-calendar-0621.png') });
    log('캘린더 2027-06-21: 먼 계약의 종료 통보기한(중요 · 입력한 계약 정보 기준) + 갱신 여부 확인(PACTO 안내) 그대로 표시');
  } catch (e) {
    console.log('✘', e.message);
    await page.screenshot({ path: path.join(SHOTS, 'important-error.png'), fullPage: true });
    process.exitCode = 1;
  }
  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
})();
