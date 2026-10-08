/**
 * 앱 실행 화면 — 심볼 + PACTO + "모든 계약을 한곳에." (로딩 문구 없음, 상단 스피너 없음, 탭바 숨김)
 * A 로그인 사용자: 실행 화면 → 홈 / B 로그아웃: 실행 화면 → 시작(로그인) 화면
 * C 느린 네트워크: 실행 화면 유지 + 문구 아래 작은 로딩 표시 → 홈 / D 소형 화면(320×568, 글자 확대): 잘림 없음
 * E 실행 화면 동안 하단 탭바가 보이지 않음
 * 사용: BASE_URL=http://localhost:8082 node e2e/splash.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, name, ok });
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${ok ? '' : ` — ${String(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 계약 목록 요청을 ms만큼 늦춘다 (느린 네트워크) */
async function slowContracts(page, ms) {
  await page.unroute('**/rest/v1/contracts*').catch(() => undefined);
  await page.route('**/rest/v1/contracts*', async (route) => {
    await sleep(ms);
    await route.continue();
  });
}

/** 실행 화면이 보이는 동안의 상태 */
async function splashState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="brand-splash"]');
    if (!el) return null;
    const tab = document.querySelector('[data-testid="tab-home"]');
    let tabVisible = false;
    if (tab) {
      const r = tab.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      tabVisible = !!top && tab.contains(top);
    }
    return { text: el.innerText, tabVisible, spinner: !!document.querySelector('[data-testid="brand-splash-spinner"]') };
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  try {
    // B. 로그아웃 상태
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    const b = await page.waitForSelector(tid('brand-splash'), { timeout: 10000 }).then(() => true).catch(() => false);
    await page.waitForSelector(tid('signin-email'), { timeout: 15000 });
    const bGone = (await page.locator(tid('brand-splash')).count()) === 0;
    check('B', '로그아웃: 실행 화면 → 시작(로그인) 화면', b && bGone, `splash=${b} gone=${bGone}`);

    // 가입 (로그인 상태 만들기)
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`splash-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

    // A·E. 로그인 사용자 다시 실행 (목록 요청 0.8초)
    await slowContracts(page, 800);
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.waitForSelector(tid('brand-splash'), { timeout: 10000 });
    await sleep(300);
    const a = await splashState(page);
    await page.screenshot({ path: path.join(SHOTS, 'splash-01.png') });
    const textOk = !!a && a.text.includes('PACTO') && a.text.includes('모든 계약을 한곳에.') && !/준비하고|불러오고|기다려/.test(a.text);
    check('A1', '실행 화면: 심볼 + PACTO + 모든 계약을 한곳에. (로딩 문구 없음)', textOk, JSON.stringify(a));
    check('E', '실행 화면 동안 하단 탭바가 보이지 않음', !!a && !a.tabVisible, JSON.stringify(a));
    check('A2', '짧은 진입에는 로딩 표시 없음', !!a && !a.spinner, JSON.stringify(a));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="brand-splash"]') && !document.querySelector('[data-testid="brand-splash-leaving"]'), null, { timeout: 5000 });
    const homeTab = await page.locator(tid('tab-home')).isVisible();
    check('A3', '데이터 준비 후 홈으로 (탭바 표시, 실행 화면 사라짐)', homeTab);

    // C. 느린 네트워크 (목록 요청 4초)
    await slowContracts(page, 4000);
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.waitForSelector(tid('brand-splash'), { timeout: 10000 });
    await sleep(2000);
    const c = await splashState(page);
    await page.screenshot({ path: path.join(SHOTS, 'splash-02-slow.png') });
    let spinnerBelow = false;
    if (c?.spinner) {
      const s = await page.locator(tid('brand-splash-spinner')).boundingBox();
      const t = await page.getByText('모든 계약을 한곳에.').first().boundingBox();
      spinnerBelow = !!s && !!t && s.y > t.y + t.height && s.height <= 24;
    }
    check('C1', '느린 네트워크: 실행 화면 유지 + 문구 아래 작은 로딩 표시 (멈춘 것처럼 보이지 않음)', !!c && c.spinner && spinnerBelow && !c.tabVisible, JSON.stringify(c));
    await page.waitForSelector(tid('home-first-run'), { timeout: 20000 });
    check('C2', '느린 네트워크: 준비되면 홈으로', true);
    await page.unroute('**/rest/v1/contracts*');

    // D. 소형 화면 + 글자 확대
    await page.setViewportSize({ width: 320, height: 568 });
    await slowContracts(page, 1500);
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.waitForSelector(tid('brand-splash'), { timeout: 10000 });
    await page.addStyleTag({ content: 'html { font-size: 130% !important; }' });
    await sleep(300);
    const d = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="brand-splash"]');
      const out = [];
      for (const n of el.querySelectorAll('*')) {
        const t = n.textContent?.trim();
        if (n.tagName === 'svg' || ((t === 'PACTO' || t === '모든 계약을 한곳에.') && n.children.length === 0)) {
          const r = n.getBoundingClientRect();
          out.push({ t: n.tagName === 'svg' ? 'logo' : t, ok: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, clipped: n.scrollWidth > n.clientWidth + 1 });
        }
      }
      return out;
    });
    await page.screenshot({ path: path.join(SHOTS, 'splash-03-small.png') });
    const dOk = ['logo', 'PACTO', '모든 계약을 한곳에.'].every((k) => d.some((x) => x.t === k && x.ok && !x.clipped));
    check('D', '소형 화면(320×568): 로고·문구 잘림 없음', dOk, JSON.stringify(d));
    await page.waitForSelector(tid('home-first-run'), { timeout: 20000 });
  } catch (e) {
    check('X', '실행 중 오류', false, e.message);
  } finally {
    console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'page errors: none');
    const failed = results.filter((r) => !r.ok).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    if (failed) process.exitCode = 1;
    await browser.close();
  }
})();
