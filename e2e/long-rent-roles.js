/**
 * 계약 당사자 자동 연결 → 사용자 역할 → 지급 방향 → 홈·캘린더 합계 (실제 데이터 모드 + 서버 mock "장기렌트", 모든 값은 가짜)
 * A 확인 화면: 계약서의 임대인·임차인이 렌탈회사(임대인)·고객(임차인) 칸에 자동으로 (확인 필요 아님) · 대표자는 따로
 * B 내 역할: 렌탈은 계약 구조로 "고객(임차인)" — 묻지 않고 보여줌 (변경 가능)
 * C 홈: 10월 총 출금 ₩5,769,000 = 일반 769,000 + 보증금 5,000,000 · 방향 확인 필요 없음
 * D 캘린더 11월: ₩649,000 (탁송비 선택 비용 제외)
 * E 수정에서 렌탈회사로 바꾸면 미리보기 → 적용 → 저장 → 홈 출금 0 · 입금 5,769,000 (금액 재입력 없음)
 * 사용: BASE_URL=http://localhost:8082 node e2e/long-rent-roles.js
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `long-rent-${n}.png`), fullPage: true });
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  const val = (id) => page.locator(`input${tid(id)}`).inputValue();

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `longrent-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '자동차_장기렌트_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
  await page.waitForTimeout(600);

  // A
  const parties = await text('section-parties');
  const provider = await val('field-parties.provider');
  const customer = await val('field-parties.customer');
  check('A1', '렌탈회사(임대인) = 주식회사 팩토렌터카 · 고객(임차인) = 김도윤 자동 입력', parties.includes('렌탈회사(임대인)') && parties.includes('고객(임차인)') && provider === '주식회사 팩토렌터카' && customer === '김도윤', `${parties} | ${provider} | ${customer}`);
  check('A2', '렌탈회사·고객 칸에 "확인 필요" 없음 · 임대인/임차인 칸이 따로 남지 않음', !parties.includes('확인 필요') && (await page.locator(`input${tid('field-parties.lessor')}`).count()) === 0, parties);
  check('A3', '법인 대표자는 따로 (대표자 박지훈)', (await val('field-parties.representative')) === '박지훈');
  await shot('01-review');

  // B
  const role = await text('role-section');
  check('B', '내 역할: 고객(임차인) · 계약 구조로 정리 (질문 없이, 변경 가능)', role.includes('나: 고객(임차인)') && role.includes('계약 구조로 정리') && (await page.locator(tid('role-question')).count()) === 0 && (await page.locator(tid('role-change')).count()) === 1, role);
  const pays = await text('section-payments');
  check('B2', '금액에 "방향 확인 필요" 없음', !pays.includes('방향 확인 필요'), pays.slice(0, 300));

  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const detailUrl = page.url();

  // C
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'));
  const total = await text('home-spending-total');
  const split = await text('home-outflow-split');
  check('C1', '홈 10월 총 출금 ₩5,769,000', total.includes('5,769,000'), total);
  check('C2', '일반 지출 769,000 + 보증금 지급 5,000,000', split.includes('769,000') && split.includes('5,000,000'), split);
  check('C3', '방향 확인 필요 안내 없음', (await page.locator(tid('home-undetermined')).count()) === 0);
  await shot('02-home');

  // D
  await page.goto(`${BASE}/calendar?date=2026-11-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const nov = await text('calendar-month-total');
  check('D', '캘린더 11월 총 출금 ₩649,000 (탁송비 선택 비용 제외)', nov.includes('총 출금 예정 ₩649,000'), nov);

  // E
  await page.goto(detailUrl.replace(/\?.*$/, '') + '/edit', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('role-change'), { timeout: 15000 });
  await page.click(tid('role-change'));
  await page.waitForSelector(tid('role-question'));
  const opts = await text('role-question');
  check('E1', '선택지: 렌탈회사(임대인) · 주식회사 팩토렌터카 / 고객(임차인) · 김도윤 / 다른 사람 / 잘 모르겠어요', opts.includes('렌탈회사(임대인) · 주식회사 팩토렌터카') && opts.includes('고객(임차인) · 김도윤') && opts.includes('다른 사람의 계약을 관리하고 있어요') && opts.includes('잘 모르겠어요'), opts);
  await page.click(tid('role-option-p0'));
  await page.waitForSelector(tid('role-preview'));
  const pv = await text('role-preview');
  check('E2', '미리보기: 보증금·월 렌트료 출금 → 입금', pv.includes('보증금') && pv.includes('월 렌트료') && pv.includes('출금(지출) → 입금(수입)'), pv);
  await page.click(tid('role-apply'));
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'));
  const t2 = await text('home-spending-total');
  const inc = (await page.locator(tid('home-income')).count()) ? await text('home-income') : '';
  check('E3', '렌탈회사 기준: 출금 ₩0 · 입금 5,769,000 (금액 다시 입력하지 않음)', t2.includes('₩0') && inc.includes('5,769,000'), `${t2} | ${inc}`);
  await shot('03-provider');

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
