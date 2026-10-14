/**
 * 대출 상환 계획 (loanPlan.ts) — 실제 데이터 모드, 로컬 Supabase · 모든 값은 가짜
 * 예전 분석처럼 저장된 대출(실행금 결제 1건 + 회차별 이자 4건 + 원금 상환)을 사용자가 정리하는 흐름:
 * A 정리 전: 저장 항목은 그대로 두되 실행금은 합계·캘린더에서 뺌 · 정리 카드 2종
 * B 실행금 정리 → 10월 출금 0 · 대출 원금 정보 3,000만원
 * C 이자 합치기 → 이자 1건 · 상환 계획 첫 납부 59,178 · 예상 이자 일정 13회 · 계약서 예시 4개 모두 일치
 * D 캘린더: 11/10 첫 이자 59,178 · 12/10 147,945 · 2027-10-19 원금 상환 + 최종 이자 93,699 (출금 카드 "원금 상환 3,000만원 포함")
 * E 수정 화면: "이자·상환 항목" · 카드 이름이 "금액 N"이 아님 · 상환 계획 미리보기
 * 사용: BASE_URL=http://localhost:8082 node e2e/loan-plan.js
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
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, !ok && detail ? `— ${String(detail).slice(0, 500)}` : '');
  if (!ok) process.exitCode = 1;
};
const env = Object.fromEntries(
  execSync('npx supabase status -o env', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((l) => /^([A-Z_]+)="(.*)"$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const EMAIL = `loan-plan-${Date.now()}@pacto.test`;
const PW = 'pacto-ui-password-1';
async function save(args) {
  const tok = await (await fetch(`${env.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
  const r = await fetch(`${env.API_URL}/rest/v1/rpc/save_contract`, { method: 'POST', headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));
  return body;
}
const pay = (o) => ({ id: null, month_of_year: null, ends_on: null, installment_count: null, is_variable: false, components: [], business_day_rule: 'none', obligation: 'confirmed', condition_note: null, payer_role: null, payee_role: null, fund_key: null, frequency: 'one_time', day_of_month: null, direction: 'expense', direction_basis: 'role', money_nature: 'ordinary', ...o });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const txt = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  const label = () => page.locator(tid('calendar-month-total')).getAttribute('aria-label');
  const cal = async (date) => {
    await page.goto(`${BASE}/calendar?date=${date}&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
    await page.waitForTimeout(400);
    return txt('calendar-day-list');
  };
  const detail = async (id) => {
    await page.goto(`${BASE}/contract/${id}?t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('loan-plan'), { timeout: 15000 });
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

  // 예전 분석처럼 저장된 대출 (계산 기준은 계약서대로 입력돼 있음)
  const id = await save({
    p_contract: {
      title: '가계 대출거래약정서', source: 'upload', contract_kind: 'loan', category: 'finance', contract_type: 'loan', start_date: '2026-10-20', end_date: '2027-10-19',
      user_party_role: 'borrower', user_party_relation: 'self', parties: [{ role: 'lender', name: '가상은행' }, { role: 'borrower', name: '박지훈' }],
      contract_details: { interest_rate: 6, rate_type: 'fixed', repayment_method: 'bullet', interest_day_count: 'actual_365', interest_period: 'calendar_month', interest_rounding: 'round_1' },
    },
    p_funds: [],
    p_dates: [],
    p_payments: [
      pay({ kind: 'other', label: '대출 원금', amount: 30000000, starts_on: '2026-10-20' }),
      pay({ kind: 'interest', label: '첫 이자', amount: 59178, starts_on: '2026-11-10' }),
      pay({ kind: 'interest', label: '11월분 이자', amount: 147945, starts_on: '2026-12-10' }),
      pay({ kind: 'interest', label: '12월분 이자', amount: 152877, starts_on: '2027-01-10' }),
      pay({ kind: 'interest', label: '만기 최종 이자', amount: 93699, starts_on: '2027-10-19' }),
      pay({ kind: 'loan_repayment', label: '원금 상환', amount: 30000000, starts_on: '2027-10-19' }),
    ],
  });

  // A
  await cal('2026-10-20');
  check('A1', '정리 전에도 실행금은 10월 입출금 합계에 넣지 않음 (저장 항목은 그대로 — 정리 카드로 안내)', (await label()).includes('총 출금 예정 ₩0') && !(await label()).includes('입금 +'), await label());
  await detail(id);
  const disb = await page.locator('[data-testid^="loan-fix-disbursement-"][data-testid$="-apply"]').count();
  check('A2', '정리 카드: 실행금 1건 + "이자가 4개 항목으로 나뉘어 있어요"', disb === 1 && (await txt('loan-fix-interest')).includes('이자가 4개 항목'), await txt('loan-fix-interest'));
  await page.screenshot({ path: path.join(SHOTS, 'loan-01-before.png'), fullPage: true });

  // B
  await page.locator('[data-testid^="loan-fix-disbursement-"][data-testid$="-apply"]').first().click();
  await page.waitForTimeout(1500);
  check('B1', '실행금 정리 → 대출 원금 3,000만원 정보', (await txt('loan-plan')).includes('30,000,000원'), await txt('loan-plan'));
  await cal('2026-10-20');
  check('B2', '정리 후에도 10월 출금 0원 · 실행금 정리 카드 사라짐', (await label()).includes('총 출금 예정 ₩0'), await label());

  // C
  await detail(id);
  await page.click(tid('loan-fix-interest-apply'));
  await page.waitForTimeout(1500);
  await page.waitForSelector(tid('loan-plan-first'));
  const plan = await txt('loan-plan');
  check('C1', '이자 합치기 → 상환 계획 첫 납부 2026. 11. 10. · 59,178원 · 정리 카드 사라짐', plan.includes('2026. 11. 10.') && plan.includes('59,178원') && (await page.locator(tid('loan-fix-interest')).count()) === 0, plan);
  await page.click(tid('loan-plan-toggle'));
  const sched = await txt('loan-plan-schedule');
  check('C2', '예상 이자 일정 13회: 첫 이자 12일 · 11월 30일분 147,945 · 만기 최종 19일 93,699', sched.includes('첫 이자 · 10월 20일~31일 (12일)') && sched.includes('147,945원') && sched.includes('만기 최종 이자 · 10월 1일~19일 (19일)') && sched.includes('93,699원'), sched);
  check('C3', '계약서 예시 금액 4개 모두 계산과 같음', (plan.match(/✓ 계산과 같음/g) || []).length === 4 && !plan.includes('계산과 다름'), plan);
  check('C4', '만기 원금 상환 2027. 10. 19. · 30,000,000원', (await txt('loan-plan-principal')).includes('2027. 10. 19.') && (await txt('loan-plan-principal')).includes('30,000,000원'));
  await page.screenshot({ path: path.join(SHOTS, 'loan-02-plan.png'), fullPage: true });

  // D
  const nov = await cal('2026-11-10');
  check('D1', '11/10 첫 이자 59,178원 (하나만)', nov.includes('59,178원') && nov.includes('첫 이자'), nov);
  const dec = await cal('2026-12-10');
  check('D2', '12/10 이자 147,945원', dec.includes('147,945원'), dec);
  const end = await cal('2027-10-19');
  const endLabel = await label();
  check('D3', '2027-10-19: 원금 상환 30,000,000 + 최종 이자 93,699 (중복 없음) · 출금 카드 "원금 상환 3,000만원 포함"', end.includes('93,699') && end.includes('30,000,000') && endLabel.includes('대출 원금 상환 ₩30,000,000 포함') && (await txt('calendar-month-total-out')).includes('원금 상환 3,000만원 포함'), `${end} | ${endLabel}`);
  check('D4', '10월(2027) 총 출금 = 9월분 이자 147,945 + 최종 이자 93,699 + 원금 30,000,000', endLabel.includes('₩30,241,644'), endLabel);
  await page.screenshot({ path: path.join(SHOTS, 'loan-03-maturity.png'), clip: { x: 0, y: 0, width: 390, height: 844 } });

  // E
  await page.goto(`${BASE}/contract/${id}/edit?t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('section-payments'), { timeout: 15000 });
  await page.waitForTimeout(800);
  const pays = await txt('section-payments');
  check('E1', '수정 화면: "이자·상환 항목" · "금액 1" 같은 번호 이름 없음 · 대출 이자 1건 + 원금 상환', pays.includes('이자·상환 항목') && !/금액 \d/.test(pays) && pays.includes('대출 이자') && pays.includes('원금 상환'), pays.slice(0, 300));
  check('E2', '수정 화면 상환 계획 미리보기', (await page.locator(tid('form-loan-plan')).count()) === 1 && (await txt('form-loan-plan')).includes('59,178원'));
  await page.screenshot({ path: path.join(SHOTS, 'loan-04-edit.png'), fullPage: true });

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
