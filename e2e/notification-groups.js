/**
 * 알림 설정 3묶음 (실제 데이터 모드) — 입출금 알림 · 계약 만료·갱신 알림 · 중요 확인 알림
 * A 첫 화면: 3묶음(이름·설명·상태 켜짐) · 고급 설정 · 6개 종류 줄·기본 알림 시간·시간대는 첫 화면에 없음
 * B 카드 → 묶음 상세(만료·갱신 = 해지·갱신 통보기한·계약 만료·자동갱신 예정일) · 뒤로
 * C 자동갱신 예정일만 따로 끄기 → 묶음 "일부 켜짐" · "3종 중 2종 켜짐"
 * D [모두 끄기](확인) → 꺼짐 · 모든 줄 꺼짐 / E [켜기] → 따로 꺼 둔 자동갱신은 그대로 꺼짐 · 통보기한 시점 그대로(30·7·1일 전·당일)
 * F 새로고침(앱 재실행)·다른 기기(새 브라우저 로그인)에서도 같은 상태
 * G 고급 설정: 기본 알림 시간 · 알림 기준 시간대(한국) · 잠금화면 표시
 * H 작은 화면(320px): 가로 스크롤 없음 · 묶음 이름 잘림 없음
 * 사용: BASE_URL=http://localhost:8082 node e2e/notification-groups.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const email = `groups-${Date.now()}@pacto.test`;
  const password = 'pacto-ui-password-1';
  let page = await (await browser.newContext({ viewport: { width: 390, height: 1100 }, locale: 'ko-KR' })).newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => /cannot contain a nested|cannot be a descendant/.test(m.text()) && errors.push(m.text().slice(0, 150))); // 웹 버튼 중첩
    p.on('dialog', (d) => d.accept().catch(() => undefined));
  };
  watch(page);
  const text = async (id, p = page) => (await p.locator(tid(id)).first().innerText()).replace(/\s+/g, ' ');
  const settings = async (p = page) => {
    await p.goto(BASE + '/settings/notifications', { waitUntil: 'networkidle' });
    await p.waitForSelector(tid('notif-group-term'), { timeout: 15000 });
    await p.waitForTimeout(400);
  };
  const group = async (key, p = page) => {
    await p.goto(`${BASE}/settings/notification-group?group=${key}`, { waitUntil: 'networkidle' });
    await p.waitForSelector(tid('notif-group-rows'), { timeout: 15000 });
    await p.waitForTimeout(400);
  };

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

  // A
  await settings();
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const states = [await text('notif-group-money-state'), await text('notif-group-term-state'), await text('notif-group-check-state')];
  check('A', '3묶음 이름·설명·켜짐 + 고급 설정 · 종류 6줄·기본 알림 시간·시간대는 첫 화면에 없음',
    ['입출금 알림', '보험료, 급여, 월 납입금 등', '계약 만료·갱신 알림', '계약 만료, 자동갱신, 해지 통보기한', '중요 확인 알림', '보증금 반환, 갱신 여부 확인 등', '고급 설정', '중요한 계약 일정을 놓치지 않도록 알려드려요.', '필요한 알림만 간편하게 설정하세요.'].every((x) => body.includes(x)) &&
      states.every((s) => s === '켜짐') && (await page.locator('[data-testid^="notif-type-"]').count()) === 0 && (await page.locator(tid('notif-default-times')).count()) === 0 && (await page.locator(tid('notif-tz-toggle')).count()) === 0, body.slice(0, 400));
  await page.screenshot({ path: path.join(SHOTS, 'notif-groups-01.png'), fullPage: true });

  // B
  await page.click(tid('notif-group-term-summary'));
  await page.waitForSelector(tid('notif-group-rows'), { timeout: 10000 });
  const rows = await text('notif-group-rows');
  check('B', '카드 → 만료·갱신 상세: 해지·갱신 통보기한 · 계약 만료 · 자동갱신 예정일', ['해지·갱신 통보기한', '계약 만료', '자동갱신 예정일'].every((x) => rows.includes(x)) && !rows.includes('결제·입금'), rows);
  await page.goBack();
  await page.waitForSelector(tid('notif-group-term'), { timeout: 10000 });

  // C 자동갱신만 끄기
  await group('term');
  await page.click(tid('notif-type-renewal'));
  await page.waitForSelector(tid('type-enabled'));
  await page.click(tid('type-enabled'));
  await page.waitForTimeout(1000);
  await group('term');
  check('C', '자동갱신만 끔 → "일부 켜짐" · "3종 중 2종 켜짐"', (await text('notif-group-term-state')) === '일부 켜짐' && (await text('notif-group-term-summary')).includes('3종 중 2종 켜짐') && (await text('notif-type-renewal')).includes('꺼짐'));

  // D 모두 끄기
  await page.click(tid('notif-group-term-off'));
  await page.waitForTimeout(1200);
  const dRows = await text('notif-group-rows');
  check('D', '[모두 끄기] → 꺼짐 · 세 줄 모두 꺼짐 · 다른 묶음은 그대로', (await text('notif-group-term-state')) === '꺼짐' && (dRows.match(/꺼짐/g) ?? []).length === 3, dRows);
  await page.screenshot({ path: path.join(SHOTS, 'notif-groups-02-off.png'), fullPage: true });

  // E 켜기
  await page.click(tid('notif-group-term-on'));
  await page.waitForTimeout(1200);
  check('E', '[켜기] → 따로 꺼 둔 자동갱신은 꺼진 채 · 통보기한 30·7·1일 전·당일 · 계약 만료 90·30·7일 전 그대로', (await text('notif-group-term-state')) === '일부 켜짐' && (await text('notif-type-renewal')).includes('꺼짐') && (await text('notif-type-termination_notice')).includes('30·7·1일 전·당일') && (await text('notif-type-contract_end')).includes('90·30·7일 전'));
  // 입출금 묶음도 끔 (다른 기기 확인용)
  await settings();
  await page.click(tid('notif-group-money-off'));
  await page.waitForTimeout(1200);

  // F 재실행 · 다른 기기
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(tid('notif-group-term'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const afterReload = [await text('notif-group-money-state'), await text('notif-group-term-state'), await text('notif-group-check-state')];
  const other = await (await browser.newContext({ viewport: { width: 390, height: 1100 }, locale: 'ko-KR' })).newPage();
  watch(other);
  await other.goto(BASE + '/', { waitUntil: 'networkidle' });
  await other.click(tid('signin-email'));
  await other.fill(`input${tid('sign-in-email')}`, email);
  await other.fill(`input${tid('sign-in-password')}`, password);
  await other.click(tid('sign-in-submit'));
  await other.waitForSelector(tid('home-first-run'), { timeout: 15000 });
  await settings(other);
  const otherStates = [await text('notif-group-money-state', other), await text('notif-group-term-state', other), await text('notif-group-check-state', other)];
  check('F', '새로고침·다른 기기 로그인: 입출금 꺼짐 · 만료·갱신 일부 켜짐 · 중요 확인 켜짐', JSON.stringify(afterReload) === JSON.stringify(['꺼짐', '일부 켜짐', '켜짐']) && JSON.stringify(otherStates) === JSON.stringify(afterReload), `${afterReload} / ${otherStates}`);
  await other.close();

  // G 고급 설정
  await page.click(tid('notif-advanced'));
  await page.waitForSelector(tid('notif-default-times'), { timeout: 10000 });
  const adv = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('G', '고급 설정: 기본 알림 시간 · 알림 기준 시간대(한국) · 잠금화면 표시', adv.includes('기본 알림 시간') && adv.includes('알림 기준 시간대') && adv.includes('한국') && adv.includes('잠금화면 표시'), adv.slice(0, 300));

  // H 작은 화면
  await page.setViewportSize({ width: 320, height: 900 });
  await settings();
  const fit = await page.evaluate(() => {
    const titles = ['입출금 알림', '계약 만료·갱신 알림', '중요 확인 알림'].map((t) => [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === t));
    return { scroll: document.documentElement.scrollWidth <= window.innerWidth, titles: titles.every((d) => d && d.scrollWidth <= d.clientWidth + 1) };
  });
  check('H', '320px: 가로 스크롤 없음 · 묶음 이름 잘림 없음', fit.scroll && fit.titles, JSON.stringify(fit));
  await page.screenshot({ path: path.join(SHOTS, 'notif-groups-03-320.png'), fullPage: true });

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
