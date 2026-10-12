/**
 * 내 계약자 정보 · "이 계약에서 누구세요?" · 보증금 현금흐름 · 반환 기록 (실제 데이터 모드 + 서버 mock 임대차, 모든 값은 가짜)
 * A MY → 내 계약자 정보: 이름 "박지훈" 저장
 * B 임대차 계약서 등록 → 확인 화면 "이 계약에서 누구세요?" · 임차인 · 박지훈에 "추천" (자동 확정 아님) · 금액은 방향 확인 필요
 * C 임차인을 고르면 변경 예정 금액을 먼저 보여줌 → 적용 → 저장
 * D 캘린더 10월: 총 출금 예정 ₩20,950,000 (보증금 ₩20,000,000 포함) / 상세: 보증금 2,000만 = 계약금 + 잔금 · 반환 확인 기준일 = 종료일
 * E 반환 기록 500만 → 일부 반환 · 남은 1,500만 · 원래 지급 결제는 그대로
 * F 역할을 모르면(이름 없이 등록 · 잘 모르겠어요) 저장은 되고 금액은 확인 필요 (합계 제외)
 * 사용: BASE_URL=http://localhost:8082 node e2e/cashflow-role.js
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
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `cashflow-role-${n}.png`), fullPage: true });
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `cashflow-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  const upload = async (name) => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
    await chooser.setFiles({ name, mimeType: 'application/pdf', buffer: PDF });
    await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
    await page.waitForTimeout(500);
  };

  // F 먼저: 이름이 없을 때 — 안내(이름 입력·건너뛰기)가 보이고, "잘 모르겠어요"로 저장 가능 · 금액은 확인 필요
  await upload('주택_임대차_계약서.pdf');
  await page.waitForSelector(tid('role-question'), { timeout: 10000 });
  check('F1', '이름이 없으면 첫 등록에서 "계약서에 사용되는 이름을 알려주세요" [이름 저장] [건너뛰기]', (await page.locator(tid('contract-name-prompt')).count()) === 1 && (await text('contract-name-prompt')).includes('계약서에 사용되는 이름을 알려주세요'));
  await page.click(tid('contract-name-skip'));
  await page.waitForTimeout(800);
  check('F2', '건너뛰면 안내가 사라짐 (다시 묻지 않음)', (await page.locator(tid('contract-name-prompt')).count()) === 0);
  await page.click(tid('role-option-unknown'));
  await page.waitForTimeout(300);
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.goto(`${BASE}/calendar?date=2026-10-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const t0 = await text('calendar-month-total');
  check('F3', '역할 모름: 10월 총 출금 예정 ₩0 · 확인 필요 금액 제외', t0.includes('총 출금 예정 ₩0') && t0.includes('확인 필요 금액 제외'), t0);
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('home-undetermined'));
  const hu = await text('home-undetermined');
  check('F4', '홈: "계약 금액 …의 입출금 방향을 확인해주세요" + "이 계약에서 내 역할 확인" (₩0을 금액 없음처럼 두지 않음)', hu.includes('입출금 방향을 확인해주세요') && hu.includes('이 계약에서 내 역할 확인'), hu);

  // A 내 계약자 정보
  await page.goto(BASE + '/my', { waitUntil: 'networkidle' });
  await page.click(tid('open-contract-names'));
  await page.waitForSelector(tid('contract-names-screen'));
  await page.fill(`input${tid('contract-name-0')}`, '박지훈');
  await page.click(tid('contract-names-save'));
  await page.waitForTimeout(1200);
  check('A', 'MY → 내 계약자 정보: 이름 저장 후 MY로 돌아옴', (await page.locator(tid('open-contract-names')).count()) === 1);

  // B 추천 (확정 아님) · 금액은 방향 확인 필요
  await upload('주택_임대차_계약서.pdf');
  await page.waitForSelector(tid('role-question'), { timeout: 10000 });
  const q = await text('role-question');
  check('B1', '"임차인 · 박지훈"에 추천 표시 · 임대인에는 없음', q.includes('임차인 · 박지훈') && q.includes('추천') && (await page.locator(tid('role-option-p1')).innerText()).includes('추천') && !(await page.locator(tid('role-option-p0')).innerText()).includes('추천'), q);
  const pays = await text('section-payments');
  check('B2', '역할을 고르기 전에는 금액이 "방향 확인 필요"', pays.includes('방향 확인 필요'), pays.slice(0, 200));
  await shot('01-question');

  // C 고르면 변경 예정 금액 → 적용
  await page.click(tid('role-option-p1'));
  await page.waitForSelector(tid('role-preview'));
  const pv = await text('role-preview');
  check('C1', '변경 예정: 계약금·잔금(보증금)·월세·관리비 확인 필요 → 출금', pv.includes('이렇게 바뀌어요') && pv.includes('계약금') && pv.includes('(보증금)') && pv.includes('월세') && pv.includes('확인 필요 → 출금'), pv);
  await shot('02-preview');
  await page.click(tid('role-apply'));
  await page.waitForTimeout(300);
  check('C2', '적용 후 "나: 임차인 · 확정"', (await text('role-current')).includes('임차인'));
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });

  // D 상세 보증금 · 캘린더 합계
  const funds = await text('detail-funds');
  check('D1', '상세: 보증금 2,000만 = 계약금 + 잔금 · 돌려받을 돈 · 반환 확인 기준일(계약 종료일) 2028. 10. 19.', funds.includes('20,000,000원') && funds.includes('계약금 2,000,000원 + 잔금 18,000,000원') && funds.includes('돌려받을 돈') && funds.includes('반환 확인 기준일') && funds.includes('2028. 10. 19.'), funds);
  await shot('03-detail');
  const detailUrl = page.url();
  await page.goto(`${BASE}/calendar?date=2026-10-20&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const t1 = await text('calendar-month-total');
  check('D2', '캘린더 10월: 총 출금 예정 ₩20,950,000 (보증금 ₩20,000,000 포함) — 역할 모름 계약은 합계 제외', t1.includes('총 출금 예정 ₩20,950,000') && t1.includes('보증금 ₩20,000,000 포함'), t1);
  const day = await page.locator(tid('calendar-day-list')).innerText();
  check('D3', '10/20: 잔금·월세·관리비 18,950,000원 결제 예정 (38,000,000 아님)', day.includes('18,950,000원') && !day.includes('38,000,000'), day.slice(0, 300));
  await shot('04-calendar');

  // E 일부 반환
  await page.goto(detailUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('detail-funds'));
  await page.click(tid('refund-add'));
  await page.fill(`input${tid('refund-amount')}`, '5000000');
  await page.fill(`input${tid('refund-date')}`, '2028-10-19');
  await page.click(tid('refund-save'));
  await page.waitForTimeout(1500);
  const f2 = await text('detail-funds');
  check('E', '반환 500만 기록 → 일부 반환 · 반환된 금액 5,000,000원 · 남은 금액 15,000,000원', f2.includes('일부 반환') && f2.includes('5,000,000원') && f2.includes('15,000,000원'), f2);
  await shot('05-refund');

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
