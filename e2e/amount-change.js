/**
 * 반복 금액 변경 — "현재 조건이 바뀌어도 과거가 자동으로 다시 쓰이지 않는다"
 * 미리보기 데이터 '넷플릭스'(직접 입력, 매월 12일 17,000원, 2023년부터)로 확인한다. 날짜는 실행하는 날(한국 시간) 기준으로 계산.
 * A 금액 수정 → 바로 저장하지 않고 "결제 금액이 변경되었어요" 시트 (기본: 다음 결제일부터)
 * B 다음 결제일부터 → 지난 달은 그대로 17,000 / 이후 18,500 · 상세 이력 "…부터 18,500원 예정 [변경 취소]"
 * C 미래 변경 취소 → 이후 일정도 17,000으로
 * D 과거 적용일 직접 선택 → "과거 일정 N건의 금액도 변경됩니다" 경고 → 취소/적용, 지난 변경은 취소 버튼 없음
 * E "처음부터 이 금액이었어요" (적용 중인 변경이 있으면 그 변경 금액만 정정, 최초 금액은 유지)
 * F 금액을 그대로 두고 다른 항목만 수정 → 확인 없이 저장, 이력 유지
 * 사용: `npm run web`(mock 모드) 실행 후 BASE_URL=http://localhost:8081 node e2e/amount-change.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}`, !ok && detail ? `— ${detail}` : '');
  if (!ok) process.exitCode = 1;
};

// 한국 시간 오늘과 날짜 계산
const pad = (n) => String(n).padStart(2, '0');
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const iso = (y, m, d) => {
  const t = new Date(y, m - 1, d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const Y = now.getFullYear();
const M = now.getMonth() + 1;
const D = now.getDate();
const ko = (s) => s.split('-').map(Number).join('. ') + '.';
const next12 = D <= 12 ? iso(Y, M, 12) : iso(Y, M + 1, 12);
const last12 = D > 12 ? iso(Y, M, 12) : iso(Y, M - 1, 12); // 이미 지난 가장 최근 결제일
const pastFrom = iso(Y, M - 2, 1); // 두 달 전 1일
// 두 달 전 1일 ~ 어제 사이에 지난 12일 결제 수
const pastCount = [iso(Y, M - 2, 12), iso(Y, M - 1, 12), iso(Y, M, 12)].filter((d) => d < iso(Y, M, D)).length;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));

  // 미리보기(mock) 데이터는 새로고침하면 초기화되므로 앱 안에서만 이동한다
  const toMain = async () => {
    for (let i = 0; i < 5 && !(await page.locator(tid('tab-contracts')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(300);
    }
  };
  const openDetail = async () => {
    await toMain();
    await page.click(tid('tab-contracts'));
    await page.waitForSelector(tid('contracts-list'));
    await page.locator('[data-testid^="contract-row-"]', { hasText: '넷플릭스' }).first().click();
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    await page.waitForTimeout(300);
  };
  const editAmount = async (amount) => {
    await openDetail();
    await page.click(tid('edit-contract'));
    await page.waitForSelector(tid('quick-basic'), { timeout: 10000 });
    await input('quick-amount').fill(amount);
    await page.click(tid('submit-contract'));
  };
  const dayAmounts = async (date) => {
    await toMain();
    await page.click(tid('tab-calendar'));
    await page.waitForSelector(tid('calendar-title'));
    const [ty, tm] = date.split('-').map(Number);
    for (let i = 0; i < 24; i++) {
      const m = (await page.locator(tid('calendar-title')).innerText()).match(/(\d{4})년 (\d{1,2})월/);
      const diff = ty * 12 + tm - (Number(m[1]) * 12 + Number(m[2]));
      if (diff === 0) break;
      await page.click(tid(diff > 0 ? 'calendar-next' : 'calendar-prev'));
      await page.waitForTimeout(150);
    }
    await page.click(tid(`day-${date}`));
    await page.waitForTimeout(300);
    return text('calendar-day-list');
  };
  const history = async () => {
    await openDetail();
    const el = page.locator('[data-testid^="amount-history-"]');
    return (await el.count()) ? (await el.first().innerText()).replace(/\s+/g, ' ') : '';
  };

  // A
  await editAmount('18500');
  await page.waitForSelector(tid('amount-change-sheet'), { timeout: 10000 });
  const sheet = await text('amount-change-sheet');
  const nextOn = await page.locator(`${tid('amount-change-next')}[aria-checked="true"]`).count();
  check('A', `수정 완료 → 시트 "결제 금액이 변경되었어요" 17,000원 → 18,500원 · 기본 "다음 결제일부터 (${ko(next12)})"`, sheet.includes('결제 금액이 변경되었어요') && sheet.includes('17,000원 → 18,500원') && sheet.includes(`다음 결제일부터 (${ko(next12)})`) && nextOn === 1 && sheet.includes('처음부터 이 금액이었어요'), sheet);
  await page.screenshot({ path: path.join(SHOTS, 'amount-change-1-sheet.png') });

  // B
  await page.click(tid('amount-change-apply'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const h1 = await history();
  check('B1', `상세 이력: 지난 금액 17,000 유지 · "${ko(next12)}부터 18,500원 예정" + 변경 취소`, h1.includes('17,000원') && h1.includes(`${ko(next12)}부터 18,500원 예정`) && (await page.locator('[data-testid^="amount-change-cancel-"]').count()) === 1, h1);
  await page.screenshot({ path: path.join(SHOTS, 'amount-change-2-history.png'), fullPage: true });
  const pastDay = await dayAmounts(last12);
  const nextDay = await dayAmounts(next12);
  check('B2', `캘린더: 지난 결제일(${last12}) 17,000원 그대로 · 다음 결제일(${next12}) 18,500원`, pastDay.includes('17,000원') && !pastDay.includes('18,500') && nextDay.includes('18,500원'), `${pastDay.slice(0, 120)} / ${nextDay.slice(0, 120)}`);

  // C
  await openDetail();
  await page.locator('[data-testid^="amount-change-cancel-"]').first().click();
  await page.waitForTimeout(800);
  const h2 = await history();
  const nextDay2 = await dayAmounts(next12);
  check('C', '미래 변경 취소 → 이력 사라짐 · 다음 결제일도 17,000원', h2 === '' && nextDay2.includes('17,000원') && !nextDay2.includes('18,500'), `${h2} / ${nextDay2.slice(0, 120)}`);

  // D
  await editAmount('20000');
  await page.waitForSelector(tid('amount-change-sheet'));
  await page.click(tid('amount-change-date'));
  await input('amount-change-date-input').fill(pastFrom);
  await page.click(tid('amount-change-apply'));
  await page.waitForSelector(tid('amount-change-past-warning'), { timeout: 5000 });
  const warn = await text('amount-change-past-warning');
  check('D1', `과거 적용일(${pastFrom}) → "과거 일정 ${pastCount}건의 금액도 변경됩니다" 경고`, warn.includes(`${ko(pastFrom)}부터 적용하면 과거 일정 ${pastCount}건의 금액도 변경됩니다`), warn);
  await page.screenshot({ path: path.join(SHOTS, 'amount-change-3-past-warning.png') });
  await page.click(tid('amount-change-past-cancel'));
  check('D2', '경고에서 취소 → 다시 선택 화면 (저장 안 됨)', (await has('amount-change-apply')) && !(await has('amount-change-past-warning')));
  await page.click(tid('amount-change-apply'));
  await page.click(tid('amount-change-past-apply'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const h3 = await history();
  const before = await dayAmounts(iso(Y, M - 3, 12));
  const after = await dayAmounts(iso(Y, M - 2, 12));
  check('D3', `확인 후 적용: 적용일 이전(${iso(Y, M - 3, 12)}) 17,000 / 이후(${iso(Y, M - 2, 12)}) 20,000 · 지난 변경은 취소 버튼 없음`, before.includes('17,000원') && after.includes('20,000원') && h3.includes(`${ko(pastFrom)} ~`) && !h3.includes('예정'), `${h3} / ${before.slice(0, 80)} / ${after.slice(0, 80)}`);

  // E
  await editAmount('21000');
  await page.waitForSelector(tid('amount-change-sheet'));
  const sheetE = await text('amount-change-sheet');
  await page.click(tid('amount-change-correct'));
  await page.click(tid('amount-change-apply'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const h4 = await history();
  const beforeE = await dayAmounts(iso(Y, M - 3, 12));
  const afterE = await dayAmounts(iso(Y, M - 2, 12));
  check('E', '"처음부터 이 금액이었어요" → 적용 중인 변경의 금액만 21,000으로 정정 (적용일 이전은 17,000 유지)', sheetE.includes('지금 적용 중인 변경') && h4.includes('21,000원') && !h4.includes('20,000원') && beforeE.includes('17,000원') && afterE.includes('21,000원'), `${h4} / ${beforeE.slice(0, 80)}`);

  // F
  await openDetail();
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('quick-basic'));
  const shown = await input('quick-amount').inputValue();
  await input('field-title').fill('넷플릭스 프리미엄');
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(600);
  const sheetShown = await has('amount-change-sheet');
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const h5 = await history();
  check('F', '수정 화면은 현재 금액(21,000) 표시 · 금액 그대로 두고 이름만 바꾸면 확인 없이 저장 · 이력 유지', shown === '21,000' && !sheetShown && h5 === h4, `${shown} / ${h5}`);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
