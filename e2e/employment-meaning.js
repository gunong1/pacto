/**
 * 근로계약서 의미 해석 E2E (실제 데이터 모드 + 서버 mock 공급자의 근로 예시 출력)
 * 업로드 → 확인 화면(월 임금 1건·구성·직전 영업일·AI 추정·계약 체크 분류) → 저장 → 상세(다음 지급·수습·조건부 규칙)
 * → 캘린더(실제 지급일·수습 종료·2027-08-31 없음) → 조건부 규칙에 기준일 입력 → 일정 생성
 * 사용: BASE_URL=http://localhost:8082 node e2e/employment-meaning.js  (기기 날짜 2026년 10월 기준)
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (no, name, ok, detail = '') => {
  results.push({ no, name, ok, detail });
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, detail ? `— ${detail}` : '');
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: Number(process.env.VIEWPORT_HEIGHT || 844) }, locale: 'ko-KR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 첫 분석 요청의 403은 AI 처리 동의 확인(동의 후 다시 요청) — 정상 흐름
  page.on('response', (r) => r.status() >= 400 && !(r.status() === 403 && r.url().endsWith('/analyze-contract')) && errors.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`));
  globalThis.__errors = errors;
  globalThis.__page = page;
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n, full = true) => page.screenshot({ path: path.join(SHOTS, `employment-${n}.png`), fullPage: full });
  const text = (sel) => page.locator(sel).innerText();

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `employment-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // 확인 화면
  await page.click(tid('first-run-register'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '근로계약서_네오링크.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot('01-review');

  const payCount = await page.locator('[data-testid^="payment-"][data-testid$="-remove"]').count();
  const comps = await text(tid('payment-0-components')).catch(() => '');
  check(1, '월 임금 1건만 수입 (기본급·고정연장근로수당은 구성 항목)', payCount === 1 && comps.includes('기본급') && comps.includes('고정연장근로수당'), `결제 ${payCount}건 / ${comps.replace(/\n/g, ' ')}`);
  const salary = await page.locator(`input${tid('detail-annualSalary')}`).inputValue().catch(() => 'n/a');
  check(3, '연봉 임의 생성 안 함', salary === '', `연봉 칸: "${salary}"`);
  // 선택된 칩은 글자색이 흰색(textInverse)
  const chipColor = async (id) => page.locator(`${tid(id)} >> div[dir="auto"]`).first().evaluate((el) => getComputedStyle(el).color);
  const [prevColor, noneColor] = [await chipColor('payment-0-businessDay-previous'), await chipColor('payment-0-businessDay-none')];
  check(6, '급여일 휴일이면 직전 영업일 규칙', prevColor === 'rgb(255, 255, 255)' && noneColor !== prevColor, `직전 영업일 칩 ${prevColor} / 그날 그대로 칩 ${noneColor}`);
  const details = await text(tid('section-details'));
  check(10, '추정 값 표시 (고용 형태 AI 추정)', details.includes('AI 추정'), '');
  const checks = await text(tid('review-checks'));
  const sev = { info: (checks.match(/핵심 정보/g) || []).length, check: (checks.match(/확인 필요/g) || []).length, caution: (checks.match(/주의 필요/g) || []).length };
  check(11, '계약 체크 분류 (핵심 정보 / 확인 필요 / 주의 필요)', sev.info === 1 && sev.check >= 7 && sev.caution === 0, JSON.stringify(sev));
  const needed = ['근무장소·업무 변경', '고정연장근로수당', '수습기간 임금 90%', '퇴직 사전통보', '갱신 별도 협의', '비밀유지', '자산·자료 반환'];
  const missing = needed.filter((t) => !checks.includes(t));
  check(12, '필수 체크 7개', missing.length === 0, missing.length ? `누락: ${missing}` : '');
  check(7, '퇴직 30일 전 통보 = 조건부 규칙 (날짜 없음)', checks.includes('조건이 생길 때만 적용돼요') && !checks.includes('2027. 8. 31'), '');
  check(9, '자동갱신 없음 · 갱신은 별도 협의', checks.includes('갱신 별도 협의'), '');
  await page.locator(tid('section-payments')).screenshot({ path: path.join(SHOTS, 'employment-01b-review-payment.png') });
  await page.locator(tid('review-checks')).screenshot({ path: path.join(SHOTS, 'employment-01c-review-checks.png') });

  // 저장 → 상세
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot('02-detail');
  const head = await text(tid('contract-detail'));
  const next = await text(tid('detail-next-action')).catch(() => '');
  check(8, "'다음 행동'에 퇴직 통보 없음 (다음 지급만)", !next.includes('다음 행동') && next.includes('다음 지급') && !head.includes('2027. 8. 31'), next.replace(/\n/g, ' / '));
  const core = await text(tid('detail-core'));
  check(2, '핵심 정보: 월 임금 + 구성', core.includes('월 임금 구성') && core.includes('기본급 3,280,000원 + 고정연장근로수당 320,000원'), '');
  check(4, '수습기간 월 임금 3,240,000원 (PACTO 계산)', core.includes('3,240,000원') && core.includes('PACTO 계산'), '');
  check(5, '수습기간 종료 2026.12.31', core.includes('2026. 10. 1. ~ 2026. 12. 31. (3개월)'), '');
  check('6b', '다음 지급 예정 10/23(금) (10/25 일요일 → 직전 영업일)', core.includes('2026. 10. 23.'), core.match(/다음 지급 예정\n[^\n]+/)?.[0]?.replace(/\n/g, ' ') ?? '');
  await page.locator(tid('detail-core')).screenshot({ path: path.join(SHOTS, 'employment-02b-detail-core.png') });

  // 조건부 규칙: 기준일 입력 → 일정
  const ruleBtn = page.locator('[data-testid^="rule-"][data-testid$="-open"]').first();
  await ruleBtn.click();
  const dateInput = page.locator('input[data-testid^="rule-"][data-testid$="-date"]').first();
  await dateInput.fill('270331');
  await dateInput.blur();
  const ruleResult = await page.locator('[data-testid^="rule-"][data-testid$="-result"]').first().innerText();
  await page.locator(tid('detail-checks')).screenshot({ path: path.join(SHOTS, 'employment-03-rule.png') });
  await page.locator('[data-testid^="rule-"][data-testid$="-add"]').first().click();
  await page.waitForTimeout(1500);
  const sched = await text(tid('detail-schedule'));
  check('7b', '퇴직 예정일 입력 시에만 통보 기한 계산 (3/31 → 3/1)', ruleResult.includes('2027. 3. 1.') && sched.includes('퇴직 사전통보 기한'), ruleResult.replace(/\n/g, ' '));

  // 캘린더
  const day = async (d) => {
    await page.goto(`${BASE}/calendar?date=${d}&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
    await page.waitForTimeout(300);
    return (await text(tid('calendar-day-list'))).replace(/\n/g, ' ');
  };
  const d1023 = await day('2026-10-23');
  await shot('04-calendar-1023', false);
  const d1025 = await day('2026-10-25');
  const d1224 = await day('2026-12-24');
  const d1231 = await day('2026-12-31');
  await shot('05-calendar-1231', false);
  const d0125 = await day('2027-01-25');
  const d0831 = await day('2027-08-31');
  check('C1', '10/23 수습 급여 +3,240,000', d1023.includes('월 임금 (수습기간 90%)') && d1023.includes('3,240,000'), d1023);
  check('C2', '10/25(일)에는 없음', !d1025.includes('월 임금'), d1025);
  check('C3', '12/24 (12/25 성탄절 → 직전 영업일)', d1224.includes('3,240,000'), d1224);
  check('C4', '12/31 수습기간 종료 예정', d1231.includes('수습기간 종료 예정'), d1231);
  check('C5', '2027-01-25 정상 급여 +3,600,000', d0125.includes('3,600,000') && !d0125.includes('수습'), d0125);
  check('C6', '2027-08-31 통보기한 없음', !d0831.includes('통보') && !d0831.includes('퇴직'), d0831);

  console.log('\npage errors:', errors.length ? errors : 'none');
  require('fs').writeFileSync(path.join(SHOTS, 'employment-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  if (results.some((r) => !r.ok) || errors.length) process.exit(1);
})().catch(async (e) => {
  console.error('✘', e.message);
  console.error('page errors:', globalThis.__errors);
  await globalThis.__page?.screenshot({ path: path.join(SHOTS, 'employment-fail.png'), fullPage: true }).catch(() => undefined);
  process.exit(1);
});
