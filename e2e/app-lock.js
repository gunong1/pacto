/**
 * 앱 잠금 (실제 데이터 모드, 웹) — 기기 인증은 개발 빌드 전용 가짜 인증(__PACTO_FAKE_DEVICE_AUTH__)으로 대신한다.
 * 실제 지문·얼굴인식·기기 PIN 동작은 이 테스트로 검증되지 않는다 (실기기 테스트 필요).
 * 백그라운드 전환은 document.visibilityState(hidden/visible)로 흉내 낸다 (웹 AppState와 같은 신호).
 * A MY > 보안 → 앱 잠금 줄·설명 · 기본 꺼짐
 * B 켜기: 인증 취소 → 그대로 꺼짐 / 인증 성공 → 켜짐 · 잠금 시점(즉시 기본) 표시 · MY에 "앱 잠금 사용 중"
 * C 백그라운드 다녀오기(즉시) → 잠금 화면 · 계약 화면은 숨김(계약 제목이 화면 글자에 없음)
 * D 해제 실패 → 문구·계속 잠김 / 성공 → 보던 화면 그대로
 * E 새로고침(프로세스 다시 시작) → 시작하자마자 잠김 · 자동 인증 1번 · 취소하면 다시 띄우지 않음(반복 없음)
 * F 계약 주소로 바로 열기(푸시·딥링크 진입) → 잠금 먼저 · 계약 내용 안 보임 → 해제 후 그 계약
 * G 1분: 짧게 다녀오면 잠기지 않음 · 잠금 시점 변경은 인증 필요(취소 시 그대로)
 * H 끄기: 인증 취소 → 그대로 켜짐 / 성공 → 꺼짐 · 백그라운드 다녀와도 안 잠김
 * I 기기 잠금이 없는 기기 → 켤 수 없음 · 기기 설정 안내
 * J 잠금 화면에서 로그아웃 → 로그인 화면 · 다시 로그인하면 잠금 꺼짐(계정 흐름으로 복구)
 * 사용: BASE_URL=http://localhost:8082 node e2e/app-lock.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const env = Object.fromEntries(
  execSync('npx supabase status -o env', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((l) => /^([A-Z_]+)="(.*)"$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const EMAIL = `app-lock-${Date.now()}@pacto.test`;
const PW = 'pacto-ui-password-1';
const TITLE = '잠금확인용 임대차';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ko-KR' });
  // 가짜 기기 인증 + 백그라운드 흉내 (모든 페이지 로드 전에)
  await ctx.addInitScript(() => {
    const saved = sessionStorage.getItem('fakeAuth');
    globalThis.__PACTO_FAKE_DEVICE_AUTH__ = saved ? JSON.parse(saved) : { status: 'available', next: { ok: true }, calls: 0 };
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    window.__setHidden = (h) => {
      hidden = h;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG_LOCK) page.on('console', (m) => m.text().includes('applock') && console.log(m.text()));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const fakeAuth = (patch) =>
    page.evaluate((p) => {
      Object.assign(globalThis.__PACTO_FAKE_DEVICE_AUTH__, p);
      sessionStorage.setItem('fakeAuth', JSON.stringify(globalThis.__PACTO_FAKE_DEVICE_AUTH__));
    }, patch);
  const calls = () => page.evaluate(() => globalThis.__PACTO_FAKE_DEVICE_AUTH__.calls ?? 0);
  const visibleText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const isLocked = async () => (await page.locator(tid('app-lock-screen')).count()) > 0;
  const away = async (ms = 50) => {
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForTimeout(ms);
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(400);
  };
  const security = async () => {
    await page.goto(BASE + '/settings/security', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('app-lock-switch'), { timeout: 15000 });
    await page.waitForTimeout(300);
  };
  const switchOn = async () => page.locator(`${tid('app-lock-switch')} input`).first().isChecked();

  // 계정 + 계약 1개 (API)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, EMAIL);
  await page.fill(`input${tid('sign-up-password')}`, PW);
  await page.fill(`input${tid('sign-up-confirm')}`, PW);
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
  const tok = await (await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
  const contractId = await (
    await fetch(`${env.API_URL}/rest/v1/rpc/save_contract`, {
      method: 'POST',
      headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_contract: { title: TITLE, category: 'real_estate', contract_kind: 'lease', start_date: '2026-01-01', end_date: '2027-12-31' }, p_payments: [] }),
    })
  ).json();

  // A
  await page.goto(BASE + '/my', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('open-security'), { timeout: 15000 });
  const myRow = (await page.locator(tid('open-security')).innerText()).replace(/\s+/g, ' ');
  await page.click(tid('open-security'));
  await page.waitForSelector(tid('app-lock-switch'), { timeout: 10000 });
  const secText = await visibleText();
  check('A', 'MY > 보안 → 앱 잠금 · 설명 문구 · 기본 꺼짐', myRow.includes('보안') && !myRow.includes('준비중') && secText.includes('앱 잠금') && secText.includes('지문·얼굴인식 또는 기기 잠금으로 PACTO를 보호합니다.') && !(await switchOn()), myRow + ' | ' + secText.slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, 'app-lock-01-settings.png'), fullPage: true });

  // B
  await fakeAuth({ next: { ok: false, reason: 'cancel' } });
  await page.click(tid('app-lock-switch'));
  await page.waitForTimeout(500);
  const offAfterCancel = !(await switchOn());
  await fakeAuth({ next: { ok: true } });
  await page.click(tid('app-lock-switch'));
  await page.waitForSelector(tid('app-lock-grace-immediate'), { timeout: 5000 });
  const graceSel = await page.locator(tid('app-lock-grace-immediate')).getAttribute('aria-selected');
  await page.goto(BASE + '/my', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('open-security'));
  const myRow2 = await page.locator(tid('open-security')).innerText();
  check('B', '켜기: 취소하면 그대로 꺼짐 · 성공하면 켜짐 · 잠금 시점 즉시 기본 · MY "앱 잠금 사용 중"', offAfterCancel && graceSel === 'true' && myRow2.includes('앱 잠금 사용 중'), `${offAfterCancel} ${graceSel} ${myRow2}`);
  // (새로고침 후 /my는 잠겨 있을 수 있음 — 위 goto는 같은 세션이라 프로세스 재시작으로 잠금. 해제)
  if (await isLocked()) {
    await page.click(tid('app-lock-unlock'));
    await page.waitForTimeout(400);
  }

  // C
  await page.goto(`${BASE}/contract/${contractId}`, { waitUntil: 'networkidle' });
  if (await isLocked()) {
    await page.click(tid('app-lock-unlock'));
    await page.waitForTimeout(400);
  }
  await page.waitForFunction((t) => document.body.innerText.includes(t), TITLE, { timeout: 15000 });
  // 잠금 화면이 띄우는 자동 인증을 취소한 상태로 확인 (성공이면 바로 풀린다)
  await fakeAuth({ next: { ok: false, reason: 'cancel' }, calls: 0 });
  await away();
  const autoPrompted = (await calls()) === 1;
  const lockedC = await isLocked();
  const textC = await visibleText();
  const contentHidden = await page.locator(tid('app-content')).evaluate((el) => getComputedStyle(el).display === 'none');
  check('C', '백그라운드 다녀오기(즉시) → 잠금 화면 · 자동 인증 1번 · 계약 화면 숨김(제목 안 보임)', lockedC && autoPrompted && contentHidden && !textC.includes(TITLE) && textC.includes('PACTO가 잠겨 있어요'), textC.slice(0, 300));
  await page.screenshot({ path: path.join(SHOTS, 'app-lock-02-locked.png') });

  // D
  await fakeAuth({ next: { ok: false, reason: 'failed' } });
  await page.click(tid('app-lock-unlock'));
  await page.waitForTimeout(400);
  const msgD = (await page.locator(tid('app-lock-message')).count()) ? await page.locator(tid('app-lock-message')).innerText() : '';
  const stillLocked = await isLocked();
  await fakeAuth({ next: { ok: true } });
  await page.click(tid('app-lock-unlock'));
  await page.waitForTimeout(500);
  const afterD = await visibleText();
  check('D', '해제 실패 → 문구 · 계속 잠김 / 성공 → 보던 계약 화면 그대로', stillLocked && msgD.includes('인증하지 못했어요') && !(await isLocked()) && afterD.includes(TITLE), `${stillLocked} ${msgD}`);

  // E
  await fakeAuth({ next: { ok: false, reason: 'cancel' }, calls: 0 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(tid('app-lock-screen'), { timeout: 15000 });
  await page.waitForTimeout(2500);
  const textE = await visibleText();
  const callsE = await calls();
  check('E', '새로고침(재시작) → 바로 잠김 · 자동 인증 1번 · 취소 후 다시 띄우지 않음 · 계약 내용 안 보임', (await isLocked()) && callsE === 1 && !textE.includes(TITLE), `calls=${callsE}`);

  // F 딥링크(푸시 진입과 같은 경로): 새 탭에서 계약 주소로 바로
  await fakeAuth({ next: { ok: false, reason: 'cancel' }, calls: 0 });
  await page.goto(`${BASE}/contract/${contractId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('app-lock-screen'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  const textF = await visibleText();
  // 계약 화면 영역은 숨김(display: none) + 보조기기에서도 제외(aria-hidden) — 글자를 그리지 않는다
  const hiddenF = await page.locator(tid('app-content')).evaluate((el) => getComputedStyle(el).display === 'none' && el.getAttribute('aria-hidden') === 'true');
  const a11yHasTitle = JSON.stringify(await page.accessibility.snapshot()).includes(TITLE);
  await fakeAuth({ next: { ok: true } });
  await page.click(tid('app-lock-unlock'));
  await page.waitForFunction((t) => document.body.innerText.includes(t), TITLE, { timeout: 10000 }).catch(() => undefined);
  const afterF = await visibleText();
  check('F', '계약 주소로 바로 열기 → 잠금 먼저 · 계약 내용 안 보임(화면·보조기기) → 해제 후 그 계약', !textF.includes(TITLE) && hiddenF && !a11yHasTitle && afterF.includes(TITLE), `${textF.includes(TITLE)} ${hiddenF} ${a11yHasTitle}`);

  // G 1분 + 잠금 시점 변경 인증
  await security();
  await fakeAuth({ next: { ok: false, reason: 'cancel' } });
  await page.click(tid('app-lock-grace-one_minute'));
  await page.waitForTimeout(400);
  const graceUnchanged = (await page.locator(tid('app-lock-grace-immediate')).getAttribute('aria-selected')) === 'true';
  await fakeAuth({ next: { ok: true } });
  await page.click(tid('app-lock-grace-one_minute'));
  await page.waitForTimeout(400);
  const graceChanged = (await page.locator(tid('app-lock-grace-one_minute')).getAttribute('aria-selected')) === 'true';
  await away(300);
  check('G', '1분: 잠금 시점 변경은 인증 필요(취소 시 그대로) · 짧게 다녀오면 잠기지 않음', graceUnchanged && graceChanged && !(await isLocked()), `${graceUnchanged} ${graceChanged}`);

  // H 끄기
  await fakeAuth({ next: { ok: false, reason: 'cancel' } });
  await page.click(tid('app-lock-switch'));
  await page.waitForTimeout(400);
  const stillOn = await switchOn();
  await fakeAuth({ next: { ok: true } });
  await page.click(tid('app-lock-switch'));
  await page.waitForTimeout(400);
  const off = !(await switchOn());
  await away();
  check('H', '끄기: 취소하면 그대로 켜짐 · 성공하면 꺼짐 · 다녀와도 안 잠김', stillOn && off && !(await isLocked()), `${stillOn} ${off}`);

  // I 기기 잠금 없음
  await fakeAuth({ status: 'no_device_lock' });
  await security();
  await page.click(tid('app-lock-switch')).catch(() => undefined);
  await page.waitForTimeout(300);
  const textI = await visibleText();
  check('I', '기기 잠금이 없는 기기 → 켤 수 없음 · 기기 설정 안내', !(await switchOn()) && (await page.locator(tid('app-lock-no-device-lock')).count()) === 1 && textI.includes('기기 설정 열기'), textI.slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, 'app-lock-03-no-device-lock.png'), fullPage: true });

  // J 잠금 화면 로그아웃 → 다시 로그인하면 꺼짐
  await fakeAuth({ status: 'available', next: { ok: true } });
  await security();
  await page.click(tid('app-lock-switch'));
  await page.waitForTimeout(400);
  // 잠금 시점은 G에서 1분으로 바꿔 둠 → 앱을 다시 시작해 잠금
  await fakeAuth({ next: { ok: false, reason: 'cancel' } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(tid('app-lock-sign-out'), { timeout: 5000 });
  await page.click(tid('app-lock-sign-out'));
  await page.waitForSelector(tid('signin-email'), { timeout: 15000 });
  await page.click(tid('signin-email'));
  await page.fill(`input${tid('sign-in-email')}`, EMAIL);
  await page.fill(`input${tid('sign-in-password')}`, PW);
  await page.click(tid('sign-in-submit'));
  await page.waitForTimeout(3000);
  const relogged = !(await isLocked()) && (await page.locator(tid('signin-email')).count()) === 0;
  await security();
  check('J', '잠금 화면에서 로그아웃 → 다시 로그인 → 잠금 꺼짐(계정 흐름으로 복구)', relogged && !(await switchOn()));

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
