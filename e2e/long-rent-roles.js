/**
 * 계약 당사자 자동 연결 → 사용자 역할 → 지급 방향 → 홈·캘린더 합계 (실제 데이터 모드 + 서버 mock "장기렌트", 모든 값은 가짜)
 * A 확인 화면: 계약서의 임대인·임차인이 렌탈회사(임대인)·고객(임차인) 칸에 자동으로 (확인 필요 아님) · 대표자는 따로
 * B 내 역할: "고객(임차인)"은 추천일 뿐 — 확인 전에는 금액이 방향 확인 필요 (확정 출금으로 세지 않음)
 * C 확인하지 않고 저장 → 홈 ₩0 + "입출금 방향을 확인해주세요" + 추천 "고객(임차인) · 김도윤 [맞아요]"
 *   → 맞아요 → 10월 총 출금 ₩5,769,000 = 일반 769,000 + 보증금 5,000,000
 * F 이름 충돌(렌탈회사 "가상렌탈" ↔ 계약서 임대인 "주식회사 팩토렌터카"): 덮어쓰지 않고 두 후보 → 계약서 이름 선택
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
  check('A2', '렌탈회사·고객 칸에 "확인 필요" 없음 · 임대인/임차인 칸이 따로 남지 않음', !parties.split('이 계약에서 누구세요')[0].includes('확인 필요') && (await page.locator(`input${tid('field-parties.lessor')}`).count()) === 0, parties);
  check('A3', '법인 대표자는 따로 (대표자 박지훈)', (await val('field-parties.representative')) === '박지훈');
  await shot('01-review');

  // B
  const role = await text('role-section');
  check('B', '"이 계약에서 누구세요?" — 추천: 고객(임차인) (확인 전에는 합계에 넣지 않음)', (await page.locator(tid('role-question')).count()) === 1 && (await text('role-recommendation')).includes('추천: 고객(임차인)') && role.includes('추천'), role);
  const pays = await text('section-payments');
  check('B2', '확인 전 금액은 "방향 확인 필요"', pays.includes('방향 확인 필요'), pays.slice(0, 300));
  // 역할을 확인하지 않고 그대로 저장
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const detailUrl = page.url();

  // C
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'));
  const t0 = await text('home-spending-total');
  const und = await text('home-undetermined');
  check('C0', '확인 전: 홈 ₩0 · "계약 금액 …의 입출금 방향을 확인해주세요" · 추천 고객(임차인) · 김도윤 [맞아요]', t0.includes('₩0') && und.includes('입출금 방향을 확인해주세요') && und.includes('추천: 고객(임차인) · 김도윤') && (await page.locator(tid('role-confirm-yes')).count()) === 1, `${t0} | ${und}`);
  await shot('02-home-before');
  await page.click(tid('role-confirm-yes'));
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-spending-total'));
  const total = await text('home-spending-total');
  const split = await text('home-spending-lines');
  check('C1', '맞아요 → 홈 10월 총 출금 ₩5,769,000 (금액 재입력 없음)', total.includes('5,769,000'), total);
  check('C2', '계약별 줄: 769,000 + 보증금 5,000,000', split.includes('769,000') && split.includes('5,000,000'), split);
  check('C3', '방향 확인 필요 안내 사라짐', (await page.locator(tid('home-undetermined')).count()) === 0);
  await shot('02-home');

  // D
  await page.goto(`${BASE}/calendar?date=2026-11-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const nov = await page.locator(tid('calendar-month-total')).getAttribute('aria-label');
  check('D', '캘린더 11월 총 출금 ₩649,000 (탁송비 선택 비용 제외)', nov.includes('총 출금 예정 ₩649,000'), nov);

  // E
  await page.goto(detailUrl.replace(/\?.*$/, '') + '/edit', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('role-change'), { timeout: 15000 });
  check('E0', '확인한 역할: "나: 고객(임차인)" 확정', (await text('role-current')).includes('나: 고객(임차인)'));
  await page.click(tid('role-change'));
  await page.waitForSelector(tid('role-question'));
  const opts = await text('role-question');
  check('E1', '기본 선택지: 렌탈회사(임대인) · 주식회사 팩토렌터카 / 고객(임차인) · 김도윤 — 다른 사람·잘 모르겠어요는 "다른 경우" 안에', opts.includes('렌탈회사(임대인) · 주식회사 팩토렌터카') && opts.includes('고객(임차인) · 김도윤') && !opts.includes('다른 사람의 계약을 관리하고 있어요') && opts.includes('다른 경우'), opts);
  await page.click(tid('role-more'));
  const more = await text('role-more-options');
  check('E1b', '"다른 경우"를 누르면 다른 사람의 계약 관리 · 잘 모르겠어요', more.includes('다른 사람의 계약을 관리하고 있어요') && more.includes('잘 모르겠어요'), more);
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

  // F 이름 충돌
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await ch2.setFiles({ name: '장기렌트_이름충돌_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
  await page.waitForTimeout(600);
  const cf = (await page.locator(tid('party-conflict-lessor')).count()) ? await text('party-conflict-lessor') : '';
  check('F1', '렌탈회사 이름 두 가지 → 덮어쓰지 않고 두 후보(가상렌탈 / 계약서의 임대인 주식회사 팩토렌터카)', cf.includes('렌탈회사 이름이 두 가지예요') && cf.includes('가상렌탈') && cf.includes('계약서의 임대인') && cf.includes('주식회사 팩토렌터카') && (await val('field-parties.provider')) === '가상렌탈', cf);
  await shot('04-conflict');
  await page.click(tid('party-conflict-doc-lessor'));
  await page.waitForTimeout(400);
  check('F2', '계약서 이름 선택 → 렌탈회사 = 주식회사 팩토렌터카 · 후보 카드 사라짐', (await val('field-parties.provider')) === '주식회사 팩토렌터카' && (await page.locator(tid('party-conflict-lessor')).count()) === 0);

  // F3 서로 다른 당사자로 두기 → 저장 → 다시 열어도 그대로 (충돌 카드 다시 안 뜸)
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const [ch3] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await ch3.setFiles({ name: '장기렌트_이름충돌_계약서.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('party-conflict-lessor'), { timeout: 30000 });
  await page.click(tid('party-conflict-both-lessor'));
  await page.waitForTimeout(400);
  const sep = (await page.locator(tid('party-separate-lessor')).count()) ? await text('party-separate-lessor') : '';
  check('F3', '"서로 다른 당사자예요" → 임대인은 렌탈회사와 따로 (되돌리기 가능) · 두 이름 유지', sep.includes('다른 당사자로 따로') && (await val('field-parties.provider')) === '가상렌탈' && (await val('field-parties.lessor')) === '주식회사 팩토렌터카' && (await page.locator(tid('party-conflict-lessor')).count()) === 0, sep);
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.goto(page.url().replace(/\?.*$/, '') + '/edit', { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('section-parties'), { timeout: 15000 });
  check('F4', '다시 열어도 "다른 당사자" 유지 · 충돌 카드 없음', (await page.locator(tid('party-separate-lessor')).count()) === 1 && (await page.locator(tid('party-conflict-lessor')).count()) === 0);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
