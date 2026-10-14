/**
 * 보증금 반환 기록 입력 UX — 공통 금액 입력(AmountField)·공통 날짜 입력(DateField). 실제 데이터 모드, 로컬 Supabase · 모든 값은 가짜
 * A 금액: 한 글자씩 입력 → 천 단위 쉼표 즉시 · 삭제 · 붙여넣기
 * B 반환일: "숫자만 입력해도 돼요" 안내 · 계약 종료일은 참고로만 · 없는 날짜는 막힘 · 6자리(포커스 이동 시)·8자리(즉시) 자동 변환
 * C 저장: 쉼표 없는 정확한 값으로 기록 (반환 50,000,000 · 남은 150,000,000)
 * 사용: BASE_URL=http://localhost:8082 node e2e/refund-input.js
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
const EMAIL = `refund-input-${Date.now()}@pacto.test`;
const PW = 'pacto-ui-password-1';

async function rpcAsUser(args) {
  const tok = await (await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
  const r = await fetch(`${env.API_URL}/rest/v1/rpc/save_contract`, { method: 'POST', headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));
  return body;
}
const pay = (o) => ({ id: null, month_of_year: null, ends_on: null, installment_count: null, is_variable: false, components: [], business_day_rule: 'none', obligation: 'confirmed', condition_note: null, payer_role: null, payee_role: null, fund_key: null, ...o });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const val = (id) => page.locator(`input${tid(id)}`).inputValue();
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');

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

  const leaseId = await rpcAsUser({
    p_contract: {
      title: '테스트 전세계약서', contract_kind: 'lease', category: 'real_estate', contract_type: 'lease', start_date: '2026-11-30', end_date: '2028-11-29', deposit_amount: 200000000,
      user_party_role: 'lessee', user_party_relation: 'self', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }],
    },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_payments: [
      pay({ kind: 'deposit', label: '계약금', amount: 20000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-10-10', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
      pay({ kind: 'deposit', label: '잔금', amount: 180000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-11-30', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
    ],
  });

  await page.goto(`${BASE}/contract/${leaseId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('refund-add'), { timeout: 15000 });
  await page.click(tid('refund-add'));
  const amt = page.locator(`input${tid('refund-amount')}`);
  await amt.click();
  await amt.pressSequentially('200000000', { delay: 20 });
  check('A1', '한 글자씩 입력: "200,000,000" (천 단위 쉼표 즉시)', (await val('refund-amount')) === '200,000,000', await val('refund-amount'));
  await amt.press('Backspace');
  await amt.press('Backspace');
  check('A2', '끝에서 두 번 지움: "2,000,000"', (await val('refund-amount')) === '2,000,000', await val('refund-amount'));
  await amt.fill('₩50,000,000원');
  check('A3', '붙여넣기 "₩50,000,000원" → "50,000,000"', (await val('refund-amount')) === '50,000,000', await val('refund-amount'));

  // 중간 수정: "1,000|,000"에 5 → "10,005,000", 이어서 6 → "100,056,000" (쉼표가 생겨도 커서가 같은 숫자 뒤에 남아야 함)
  await amt.fill('1000000');
  await amt.evaluate((el) => el.setSelectionRange(5, 5));
  await amt.press('5');
  await amt.press('6');
  check('A4', '중간에 입력: 1,000,000 → (1,000 뒤에 5·6) → "100,056,000" (커서 유지)', (await val('refund-amount')) === '100,056,000', await val('refund-amount'));
  await amt.fill('50000000');
  const form = await text('refund-form');
  check('B1', '반환일 안내: "숫자만 입력해도 돼요 (261130 → 2026-11-30)" + 참고 계약 종료일', form.includes('숫자만 입력해도 돼요') && form.includes('261130 → 2026-11-30') && form.includes('참고: 계약 종료일 2028. 11. 29.'), form);
  const dt = page.locator(`input${tid('refund-date')}`);
  check('B2', '반환일은 오늘로 시작 (계약 종료일을 자동으로 넣지 않음)', (await val('refund-date')) !== '2028-11-29', await val('refund-date'));
  await dt.fill('');
  await dt.pressSequentially('281332');
  await amt.click();
  await page.waitForTimeout(300);
  const bad = await text('refund-form');
  check('B3', '없는 날짜(281332): 안내 표시 · 기록 버튼 막힘', bad.includes('올바른 날짜가 아니에요') && (await page.locator(tid('refund-save')).isDisabled().catch(() => false) || (await page.locator(tid('refund-save')).getAttribute('aria-disabled')) === 'true'), bad);
  await dt.fill('');
  await dt.pressSequentially('281129');
  await amt.click();
  await page.waitForTimeout(300);
  check('B4', '6자리 281129 → 포커스 이동 시 "2028-11-29"', (await val('refund-date')) === '2028-11-29', await val('refund-date'));
  await dt.fill('');
  await dt.pressSequentially('20281130');
  check('B5', '8자리 20281130 → 입력 즉시 "2028-11-30"', (await val('refund-date')) === '2028-11-30', await val('refund-date'));

  await page.click(tid('refund-save'));
  await page.waitForTimeout(2000);
  const funds = await text('detail-funds');
  check('C1', '저장: 반환된 금액 50,000,000원 · 남은 금액 150,000,000원 (쉼표 없는 정확한 값으로 저장)', funds.includes('50,000,000원') && funds.includes('150,000,000원') && funds.includes('2028. 11. 30.'), funds);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
