/**
 * "이 계약에서 누구세요?" 역할 선택 UX (공통 컴포넌트 RoleSection · 규칙 roleChoices). 실제 데이터 모드 + 서버 mock 임대차, 모든 값은 가짜
 * A 등록 확인: 기본 선택지는 임대인·임차인 — 다른 사람의 계약 관리·잘 모르겠어요는 "다른 경우" 안에
 * B 수정: 중개업자 이름 입력 → 중개업자는 기본 선택지에 없고 "다른 경우"에만 · 당사자 정보로는 그대로 저장
 * C 잘 모르겠어요 → 접힌 상태에서 "미정"(확정 아님) + [역할 선택]이 화면 안에 보임 → 저장 → 앱 다시 열기 → 그대로 · 합계 제외
 * D 다시 역할 선택(임차인) → 저장 → 앱 다시 열기 → "나: 임차인 · 확정" · 중개업자 유지 · 10월 합계 복귀
 * 사용: BASE_URL=http://localhost:8082 node e2e/role-picker.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (no, name, ok, detail = '') => {
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, !ok && detail ? `— ${String(detail).slice(0, 400)}` : '');
  if (!ok) process.exitCode = 1;
};
const PDF = require('./cleanPdf')();
const W = 390;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  let page = await context.newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept().catch(() => undefined));
  };
  watch(page);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `role-picker-${n}.png`), fullPage: true });
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  const count = (id) => page.locator(tid(id)).count();
  /** 앱 다시 열기: 탭을 닫고 같은 로그인 상태로 새 탭에서 연다 (메모리 상태 없이 저장된 값만) */
  const reopen = async (url) => {
    await page.close();
    page = await context.newPage();
    watch(page);
    await page.goto(url, { waitUntil: 'networkidle' });
  };
  const monthTotal = async () => {
    await page.goto(`${BASE}/calendar?date=2026-10-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-month-total'));
    return page.locator(tid('calendar-month-total')).getAttribute('aria-label');
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `role-picker-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // A 등록 확인
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '주택_임대차_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('role-question'), { timeout: 30000 });
  if (await count('contract-name-skip')) {
    await page.click(tid('contract-name-skip'));
    await page.waitForTimeout(800);
  }
  const q = await text('role-question');
  check('A1', '기본 선택지: 임대인 · 김민수 / 임차인 · 박지훈', q.includes('임대인 · 김민수') && q.includes('임차인 · 박지훈'), q);
  check('A2', '다른 사람의 계약 관리·잘 모르겠어요는 처음에 보이지 않고 "다른 경우"로', !q.includes('다른 사람의 계약을 관리하고 있어요') && !q.includes('잘 모르겠어요') && (await count('role-more')) === 1, q);
  await shot('01-review');
  await page.click(tid('role-option-p1'));
  await page.waitForSelector(tid('role-preview'));
  await page.click(tid('role-apply'));
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const editUrl = page.url().replace(/\?.*$/, '') + '/edit';
  const t0 = await monthTotal();
  check('A3', '임차인 확정: 10월 총 출금 예정 ₩20,950,000', t0.includes('총 출금 예정 ₩20,950,000'), t0);

  // B 중개업자
  await page.goto(editUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('role-change'), { timeout: 15000 });
  await page.fill(`input${tid('field-parties.broker')}`, '이현정');
  await page.waitForTimeout(300);
  await page.click(tid('role-change'));
  await page.waitForSelector(tid('role-question'));
  const q2 = await text('role-question');
  check('B1', '중개업자는 기본 선택지에 없음', !q2.includes('중개업자') && (await count('role-more-options')) === 0, q2);
  await page.click(tid('role-more'));
  const more = await text('role-more-options');
  check('B2', '"다른 경우": 중개업자 · 이현정 / 다른 사람의 계약 관리 / 잘 모르겠어요', more.includes('중개업자 · 이현정') && more.includes('다른 사람의 계약을 관리하고 있어요') && more.includes('잘 모르겠어요'), more);
  await shot('02-more');

  // C 잘 모르겠어요 → 저장 → 다시 열기
  await page.click(tid('role-option-unknown'));
  if (await count('role-preview')) await page.click(tid('role-apply'));
  await page.waitForSelector(tid('role-summary'));
  const s1 = await text('role-summary');
  const box = await page.locator(tid('role-change')).boundingBox();
  check('C1', '모름: "잘 모르겠어요로 두었어요" + 미정 (확정 아님) + [역할 선택]이 화면 안에', s1.includes('잘 모르겠어요로 두었어요') && s1.includes('미정') && !s1.includes('확정') && s1.includes('역할 선택') && !!box && box.x >= 0 && box.x + box.width <= W, `${s1} | ${JSON.stringify(box)}`);
  await shot('03-unknown');
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(2500); // 수정 화면은 저장 후 이전 화면으로 (직접 연 주소라 이동할 곳 없음)
  await reopen(editUrl);
  await page.waitForSelector(tid('role-summary'), { timeout: 15000 });
  const s2 = await text('role-summary');
  check('C2', '앱 다시 열기: 그대로 "미정" + [역할 선택] · 중개업자 이름 유지', s2.includes('미정') && s2.includes('역할 선택') && (await page.locator(`input${tid('field-parties.broker')}`).inputValue()) === '이현정', s2);
  const t1 = await monthTotal();
  check('C3', '모름: 역할로 정한 금액은 합계 제외 (₩20,950,000이 아님)', !t1.includes('₩20,950,000') && t1.includes('확인 필요 금액 제외'), t1);

  // D 다시 역할 선택 → 저장 → 다시 열기
  await page.goto(editUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('role-change'), { timeout: 15000 });
  await page.click(tid('role-change'));
  await page.waitForSelector(tid('role-question'));
  await page.click(tid('role-option-p1'));
  if (await count('role-preview')) await page.click(tid('role-apply'));
  await page.waitForSelector(tid('role-summary'));
  check('D1', '다시 고르면 "나: 임차인" 확정 · [변경]', (await text('role-summary')).includes('나: 임차인') && (await text('role-summary')).includes('확정') && (await text('role-change')) === '변경');
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(2500); // 수정 화면은 저장 후 이전 화면으로 (직접 연 주소라 이동할 곳 없음)
  await reopen(editUrl);
  await page.waitForSelector(tid('role-summary'), { timeout: 15000 });
  const s3 = await text('role-summary');
  check('D2', '앱 다시 열기: "나: 임차인 · 확정" · 중개업자 이름 유지', s3.includes('나: 임차인') && s3.includes('확정') && (await page.locator(`input${tid('field-parties.broker')}`).inputValue()) === '이현정', s3);
  await shot('04-again');
  const t2 = await monthTotal();
  check('D3', '10월 총 출금 예정 ₩20,950,000으로 복귀 (보증금 ₩20,000,000 포함)', t2.includes('총 출금 예정 ₩20,950,000') && t2.includes('보증금 ₩20,000,000 포함'), t2);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
