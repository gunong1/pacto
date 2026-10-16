/**
 * 알림 화면 — 중요한 계약 일정 카드 전체 터치 (실제 데이터 모드, 390px)
 * A 카드 설명 문구를 누르면 계약 상세 · B 날짜를 눌러도 · C 카드 빈 공간(오른쪽 아래)을 눌러도 계약 상세
 * D 오른쪽 위 라벨("확인"·"중요")은 상태 표시 — 버튼이 아니어서 누르면 카드와 같이 계약 상세 · "계약 확인" 글자도 그대로 동작
 * E 다른 탭에서 계약 삭제 → 남아 있던 카드를 누르면 "계약을 찾을 수 없어요" 안내 · 이동 안 함
 * ("관련 조항 보기"는 계약서 근거가 있는 알림에만 있어 이 테스트로는 확인하지 못함 — 카드 안 별도 버튼이라 카드 이동을 일으키지 않게 구성)
 * 사용: BASE_URL=http://localhost:8082 node e2e/notification-card-tap.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const yymmdd = (n) => {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 1200 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => undefined);
  });
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const card = (p = page) => p.locator('[role="button"][aria-label*="오피스텔 임대차"]').first();
  const toNotifications = async (p = page) => {
    await p.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await p.waitForSelector(tid('important-list'), { timeout: 15000 });
    await card(p).waitFor({ timeout: 15000 });
    // 첫 화면 스플래시가 사라질 때까지 (덮여 있으면 좌표 클릭이 스플래시에 맞음)
    await p.waitForSelector(tid('brand-splash'), { state: 'detached', timeout: 10000 }).catch(() => undefined);
    await p.waitForSelector(tid('brand-splash-leaving'), { state: 'detached', timeout: 5000 }).catch(() => undefined);
  };
  const opened = async () => {
    await page.waitForSelector(tid('detail-core'), { timeout: 10000 }).catch(() => undefined);
    return /\/contract\/[^/?]+/.test(page.url()) && (await page.locator(tid('detail-core')).count()) === 1;
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await input('sign-up-email').fill(`cardtap-${Date.now()}@pacto.test`);
  await input('sign-up-password').fill('pacto-ui-password-1');
  await input('sign-up-confirm').fill('pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
  // 만기 오늘+50일 · 종료 통보 30일 전 → 알림 화면에 카드
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.click(tid('method-manual'));
  await page.click(tid('toggle-more'));
  await page.click(tid('kind-lease'));
  await input('field-title').fill('오피스텔 임대차');
  await input('field-startDate').fill(yymmdd(-300));
  await input('field-endDate').fill(yymmdd(50));
  await page.click(tid('detail-leaseKind-monthly'));
  await input('field-terminationNoticeDays').fill('30');
  await page.click(tid('notice-kind-termination_notice'));
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const contractUrl = page.url().replace(/\?.*$/, '');

  // A 설명 문구
  await toNotifications();
  await page.screenshot({ path: path.join(SHOTS, 'card-tap-01.png') });
  await card().locator('text=/확인해주세요|확인하세요|알려/').first().click();
  check('A', '카드 설명 문구 누름 → 계약 상세', (await opened()) && page.url().startsWith(contractUrl), page.url());

  // B 날짜
  await toNotifications();
  await card().locator('text=/D-\\d+|오늘/').first().click();
  check('B', '날짜(D-day) 누름 → 계약 상세', await opened(), page.url());

  // C 빈 공간 (카드 오른쪽 아래 모서리 근처)
  await toNotifications();
  const box = await card().boundingBox();
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 10);
  check('C', '카드 빈 공간 누름 → 계약 상세', await opened(), `${page.url()}`);

  // D 라벨 + "계약 확인"
  await toNotifications();
  const badgeText = (await card().locator('text=/^(확인|중요|기한 임박|확인 필요)$/').first().innerText()).trim();
  await card().locator('text=/^(확인|중요|기한 임박|확인 필요)$/').first().click();
  const viaBadge = await opened();
  await toNotifications();
  await card().locator('text=계약 확인').click();
  check('D', `오른쪽 위 라벨 "${badgeText}"(상태 표시) → 카드와 같이 상세 · "계약 확인" 글자도 상세`, viaBadge && (await opened()));

  // E 다른 탭에서 삭제
  await toNotifications();
  const other = await context.newPage();
  other.on('dialog', (d) => d.accept().catch(() => undefined));
  await other.goto(contractUrl, { waitUntil: 'networkidle' });
  await other.waitForSelector(tid('delete-contract'), { timeout: 15000 });
  await other.click(tid('delete-contract'));
  // 새 탭은 뒤로 갈 화면이 없어 목록으로 가지 않을 수 있음 → 삭제 반영만 기다림
  await other.waitForTimeout(3000);
  await other.close();
  const before = page.url();
  dialogs.length = 0;
  await card().locator('text=/D-\\d+|오늘/').first().click();
  await page.waitForTimeout(1500);
  check('E', '다른 탭에서 삭제된 계약 카드 → "계약을 찾을 수 없어요" 안내 · 알림 화면에 그대로', dialogs.some((m) => m.includes('계약을 찾을 수 없어요')) && page.url() === before && (await page.locator(tid('detail-core')).count()) === 0, `${dialogs} / ${page.url()}`);

  check('Z', '화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
