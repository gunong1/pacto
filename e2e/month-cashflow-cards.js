/**
 * 캘린더 상단 월간 현금 흐름 카드 (MonthCashflowCards — 화면 표현만, 합계는 monthSpending). 실제 데이터 모드, 로컬 Supabase · 모든 값은 가짜
 * A 11월: 출금 예정 43,500,000 (보증금 20,000,000 포함) · 입금 예정 +1,700,000 — 카드 2장, 숫자 잘림 없음
 * B 좁은 화면(320px)·큰 금액: 짧은 표기로 바뀌고 잘리지 않음 · C 0원 달 · D 월 이동 시 카드가 함께 바뀜 · Z 페이지 오류 없음
 * 사용: BASE_URL=http://localhost:8082 node e2e/month-cashflow-cards.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execSync } = require('child_process');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (no, name, ok, detail = '') => {
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, !ok && detail ? `— ${String(detail).slice(0, 400)}` : '');
  if (!ok) process.exitCode = 1;
};
const env = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, ''));
const EMAIL = `month-cards-${Date.now()}@pacto.test`;
const PW = 'pacto-ui-password-1';
let token = null;
async function save(args) {
  token ??= (await (await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token;
  const r = await fetch(`${env.API_URL}/rest/v1/rpc/save_contract`, { method: 'POST', headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));
  return body;
}
const pay = (o) => ({ id: null, month_of_year: null, ends_on: null, installment_count: null, is_variable: false, components: [], business_day_rule: 'none', obligation: 'confirmed', condition_note: null, payer_role: null, payee_role: null, fund_key: null, frequency: 'one_time', day_of_month: null, ...o });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const label = () => page.locator(tid('calendar-month-total')).getAttribute('aria-label');
  const txt = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  // 금액 칸이 잘리지 않았는지: 글자 실제 폭 <= 보이는 폭, 카드가 화면 밖으로 나가지 않음
  const fits = (id) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const card = el.closest('[data-testid$="-out"],[data-testid$="-in"]').getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && card.right <= window.innerWidth + 0.5 && card.left >= -0.5;
    }, tid(id));
  const open = async (date) => {
    await page.goto(`${BASE}/calendar?date=${date}&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-month-total-out-amount'), { timeout: 15000 });
    await page.waitForTimeout(400);
  };

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

  // 11월: 보증금 계약금 2,000만(출금) + 공사 대금 2,350만(출금) + 용역 대금 170만(입금)
  await save({
    p_contract: { title: '테스트 전세', contract_kind: 'lease', category: 'real_estate', contract_type: 'lease', start_date: '2027-01-10', end_date: '2029-01-09', deposit_amount: 200000000, user_party_role: 'lessee', user_party_relation: 'self', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }] },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_dates: [],
    p_payments: [
      pay({ kind: 'deposit', label: '보증금 계약금', amount: 20000000, starts_on: '2026-11-03', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
      // 큰 금액 (2027년 1월): 18억 3,456만 7,890원
      pay({ kind: 'deposit', label: '보증금 잔금', amount: 1834567890, starts_on: '2027-01-10', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
    ],
  });
  await save({
    p_contract: { title: '테스트 공사계약', contract_kind: 'service', category: 'service', contract_type: 'service', start_date: '2026-11-01', end_date: '2026-11-30', user_party_role: 'client', user_party_relation: 'self', parties: [{ role: 'contractor', name: '가상건설' }, { role: 'client', name: '박지훈' }] },
    p_funds: [], p_dates: [],
    p_payments: [pay({ kind: 'other', label: '공사 대금', amount: 23500000, starts_on: '2026-11-20', direction: 'expense', direction_basis: 'user', money_nature: 'ordinary' })],
  });
  await save({
    p_contract: { title: '테스트 용역계약', contract_kind: 'service', category: 'service', contract_type: 'service', start_date: '2026-11-01', end_date: '2026-11-30', user_party_role: 'contractor', user_party_relation: 'self', parties: [{ role: 'client', name: '가상회사' }, { role: 'contractor', name: '박지훈' }] },
    p_funds: [], p_dates: [],
    p_payments: [pay({ kind: 'other', label: '용역 대금', amount: 1700000, starts_on: '2026-11-10', direction: 'income', direction_basis: 'user', money_nature: 'ordinary' })],
  });

  // A
  await open('2026-11-10');
  const a = await label();
  check('A1', '합계는 기존 집계 그대로: 총 출금 ₩43,500,000 (보증금 ₩20,000,000 포함) · 입금 +₩1,700,000', a.includes('총 출금 예정 ₩43,500,000 (보증금 ₩20,000,000 포함)') && a.includes('입금 +₩1,700,000'), a);
  const out = await txt('calendar-month-total-out');
  const inn = await txt('calendar-month-total-in');
  check('A2', '출금 카드: 제목·금액·"보증금 2,000만원 포함"', out.includes('출금 예정') && /43,500,000원|4,350만원/.test(out) && out.includes('보증금 2,000만원 포함'), out);
  check('A3', '입금 카드: 제목·"+" 금액 (화살표·제목으로도 구분)', inn.includes('입금 예정') && /\+1,700,000원|\+170만원/.test(inn), inn);
  check('A4', '390px: 두 카드가 한 줄(2열) · 숫자 잘림 없음', (await fits('calendar-month-total-out-amount')) && (await fits('calendar-month-total-in-amount')) && (await page.locator(tid('calendar-month-total-out')).boundingBox()).y === (await page.locator(tid('calendar-month-total-in')).boundingBox()).y);
  await page.screenshot({ path: path.join(SHOTS, 'month-cards-01-390-nov.png'), clip: { x: 0, y: 0, width: 390, height: 420 } });

  // B 좁은 화면
  await page.setViewportSize({ width: 320, height: 700 });
  await open('2026-11-10');
  const outB = await txt('calendar-month-total-out-amount');
  check('B1', '320px: 숫자 잘림 없음 (필요하면 짧은 표기)', (await fits('calendar-month-total-out-amount')) && (await fits('calendar-month-total-in-amount')), outB);
  const subB = await page.locator(tid('calendar-month-total-out-sub')).evaluate((el) => [...el.children].map((c) => c.textContent));
  check('B2', '320px: "보증금 2,000만원 포함"은 어절 단위로만 줄바꿈', subB.join('|') === '보증금 2,000만원|포함', subB.join('|'));
  await page.screenshot({ path: path.join(SHOTS, 'month-cards-02-320-nov.png'), clip: { x: 0, y: 0, width: 320, height: 420 } });
  await open('2027-01-10');
  const big = await txt('calendar-month-total-out-amount');
  const outBox = await page.locator(tid('calendar-month-total-out')).boundingBox();
  const inBox = await page.locator(tid('calendar-month-total-in')).boundingBox();
  check('B3', '320px · 큰 금액(18억대): 2열에 안 들어가면 1열로 쌓고 잘림 없음 (금액은 원 단위까지 그대로)', (await fits('calendar-month-total-out-amount')) && inBox.y > outBox.y && /1,834,567,890원|18억 3,456만 7,890원/.test(big) && (await label()).includes('₩1,834,567,890'), `${big} out.y=${outBox.y} in.y=${inBox.y}`);
  await page.screenshot({ path: path.join(SHOTS, 'month-cards-04-320-big.png'), clip: { x: 0, y: 0, width: 320, height: 420 } });
  await page.setViewportSize({ width: 390, height: 844 });

  // C·D 0원 달 + 월 이동
  await open('2026-11-10');
  await page.click(tid('calendar-next'));
  await page.waitForTimeout(500);
  const dec = await label();
  const decOut = await txt('calendar-month-total-out');
  check('D1', '다음 달(12월)로 이동하면 카드도 바뀜: 출금 0원 · 입금 예정 없음', dec.includes('총 출금 예정 ₩0') && dec.includes('입금 예정 없음') && decOut.includes('0원') && !decOut.includes('보증금'), `${dec} | ${decOut}`);
  await page.screenshot({ path: path.join(SHOTS, 'month-cards-03-390-dec-zero.png'), clip: { x: 0, y: 0, width: 390, height: 420 } });
  await page.click(tid('calendar-prev'));
  await page.waitForTimeout(500);
  check('D2', '다시 11월로: 원래 합계', (await label()).includes('₩43,500,000'));

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
