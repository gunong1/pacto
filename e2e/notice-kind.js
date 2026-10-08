/**
 * 통보기한의 의미 (notice_kind) — 직접 입력한 주택 임대차 2026-10-20 ~ 2028-10-19, 종료 60일 전(=2028-08-20)
 * 1 의미를 고르지 않으면(잘 모르겠어요) → "통보·갱신 관련 기한이 있어요." / "이 일정의 의미를 확인해주세요." / 핵심 정보에 확인 필요
 * 2 계약 수정에서 "갱신 여부 확인·협의" → "갱신 여부 확인까지 N일 남았습니다." / "…2028년 8월 20일까지 갱신 여부를 상대방과 협의해주세요."
 * 3 캘린더 8/20: 갱신 여부 확인 1건 (PACTO 기본 안내와 겹치지 않음)
 * 4 알림 설정: 해지·갱신 통보기한 / 갱신 여부 확인 (종류별 키로 저장)
 * 사용: BASE_URL=http://localhost:8082 node e2e/notice-kind.js  (기기 날짜 2026년 10월 기준)
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

/** 오늘(한국 시간) → 2028-08-20까지 남은 날 */
function daysToDeadline() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return Math.round((Date.UTC(2028, 7, 20) - today) / 86400000);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `notice-kind-${name}.png`), fullPage: true });
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`notice-kind-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

    // 1) 의미를 고르지 않고 저장 → unknown
    await page.click(tid('first-run-register'));
    await page.click(tid('method-manual'));
    await page.click(tid('type-lease'));
    await input('field-title').fill('주택 월세 임대차계약');
    await page.click(tid('category-real_estate'));
    await input('field-startDate').fill('261020');
    await input('field-endDate').fill('281019');
    assert((await page.locator(tid('notice-kind')).count()) === 0, '일수를 넣기 전에 의미 선택지가 보임');
    await input('field-terminationNoticeDays').fill('60');
    await page.waitForSelector(tid('notice-kind'));
    const options = await page.locator(tid('notice-kind')).innerText();
    for (const o of ['해지·종료 통보기한', '갱신 통보기한', '갱신 여부 확인·협의', '잘 모르겠어요']) assert(options.includes(o), `선택지 없음: ${o}`);
    assert((await page.locator(tid('notice-kind-unknown')).getAttribute('aria-checked')) === 'true', '기본값이 "잘 모르겠어요"가 아님');
    await shot('01-form');
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-next-headline'), { timeout: 15000 });
    let action = await page.locator(tid('detail-next-action')).innerText();
    assert(action.includes('통보·갱신 관련 기한이 있어요.') && action.includes('이 일정의 의미를 확인해주세요.'), '의미 불확실 문구 없음: ' + action);
    const core = await page.locator(tid('detail-core')).innerText();
    assert(core.includes('통보·갱신 관련 기한') && core.includes('확인 필요'), '핵심 정보에 확인 필요 없음: ' + core);
    await shot('02-unknown');
    log('1 의미를 고르지 않음 → "통보·갱신 관련 기한이 있어요." / "이 일정의 의미를 확인해주세요." / 핵심 정보 확인 필요');

    // 2) 수정 → 갱신 여부 확인·협의
    await page.click(tid('edit-contract'));
    await page.waitForSelector(tid('notice-kind'));
    await page.click(tid('notice-kind-renewal_decision'));
    await page.click(tid('submit-contract'));
    await page.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes('갱신 여부 확인까지'), tid('detail-next-headline'), { timeout: 15000 });
    action = await page.locator(tid('detail-next-action')).innerText();
    const days = daysToDeadline();
    assert(action.includes(`갱신 여부 확인까지 ${days}일 남았습니다.`), `남은 날 문구 불일치 (${days}일): ` + action);
    assert(action.includes('입력한 계약 정보에 따라 2028년 8월 20일까지 갱신 여부를 상대방과 협의해주세요.'), '협의 안내 문구 없음: ' + action);
    assert(action.includes('갱신 여부 확인 · 2028. 8. 20.'), '라벨·날짜 없음: ' + action);
    assert(!action.includes('통보해야') && !action.includes('해지 의사'), '협의를 통보 의무로 강하게 표현함: ' + action);
    await shot('03-renewal-decision');
    log(`2 수정 → 갱신 여부 확인·협의: "갱신 여부 확인까지 ${days}일 남았습니다." · 2028년 8월 20일까지 협의 · 갱신 여부 확인 · 2028. 8. 20.`);

    // 3) 캘린더 8/20 — 갱신 여부 확인 1건 (PACTO 기본 안내와 중복 없음)
    await page.click(tid('detail-open-calendar'));
    await page.waitForSelector(tid('calendar-day-list'));
    const day = await page.locator(tid('calendar-day-list')).innerText();
    assert(day.includes('2028. 8. 20.') && day.includes('갱신 여부 확인'), '캘린더 8/20 없음: ' + day);
    assert(day.split('갱신 여부 확인').length - 1 === 1, '갱신 여부 확인이 중복 표시됨: ' + day);
    await shot('04-calendar');
    log('3 캘린더 2028. 8. 20.: 갱신 여부 확인 1건');

    // 4) 알림 설정 — 묶음 표시
    await page.goto(BASE + '/settings/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('notif-renewal_decision'));
    const st = await page.locator('body').innerText();
    assert(st.includes('해지·갱신 통보기한') && st.includes('갱신 여부 확인'), '알림 설정 묶음 없음');
    assert(await page.locator(tid('notif-renewal_decision-30')).isVisible(), '갱신 여부 확인 기본 시점 없음');
    await shot('05-settings');
    log('4 알림 설정: 해지·갱신 통보기한 / 갱신 여부 확인 (기본 30·7일 전)');

    console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'page errors: none');
  } catch (e) {
    console.log('✘', e.message);
    await shot('error').catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
