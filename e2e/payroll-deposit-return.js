/**
 * 급여 카드 + 결제로 저장된 보증금 반환 정리 (실제 데이터 모드, 로컬 Supabase · 모든 값은 가짜)
 * 데이터는 앱과 같은 저장 함수(save_contract)로 넣는다 (그 사용자로 로그인한 상태).
 * A 근로: 세전 고정 월 급여 3,200,000 · 구성(기본급·고정 직무수당) · 추가 지급 가능(성과급 최대 1,000,000 · 미확정) · 예시 4,200,000 · 첫 급여 722,581 계산 내역
 * B 성과급 지급 확정(12/31 · 800,000) → 12월 입금 예정에 800,000 추가 · 상태 "지급 확정" · 버튼 사라짐
 * C 전세: "보증금 반환 예정"(기타·확정·일반·출금) 정리 카드 → "반환일은 따로 없어요" → 카드 사라짐 · 2028년 11월 출금 ₩0
 * 사용: BASE_URL=http://localhost:8082 node e2e/payroll-deposit-return.js
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
const EMAIL = `payroll-${Date.now()}@pacto.test`;
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
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `payroll-${n}.png`), fullPage: true });
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

  const jobId = await rpcAsUser({
    p_contract: {
      title: '테스트 근로계약서', contract_kind: 'employment', category: 'employment', contract_type: 'employment', start_date: '2026-10-25',
      user_party_role: 'employee', user_party_relation: 'self', parties: [{ role: 'employer', name: '가상회사' }, { role: 'employee', name: '홍길동' }],
      contract_details: { pay_period_start_day: 1, pay_timing: 'next_month', proration_basis: 'calendar_days' },
    },
    p_payments: [pay({
      kind: 'salary', label: '월 급여', amount: 3200000, frequency: 'monthly', day_of_month: 10, starts_on: '2026-10-25', direction: 'income', direction_basis: 'role', money_nature: 'ordinary',
      components: [
        { label: '기본급', amount: 2800000, pay: 'fixed', amountKind: 'exact' },
        { label: '고정 직무수당', amount: 400000, pay: 'fixed', amountKind: 'exact' },
        { label: '성과급', amount: 1000000, pay: 'conditional', amountKind: 'max', condition: '분기 목표 달성 시', status: 'pending' },
      ],
    })],
  });
  const leaseId = await rpcAsUser({
    p_contract: {
      title: '테스트 전세계약서', contract_kind: 'lease', category: 'real_estate', contract_type: 'lease', start_date: '2026-11-30', end_date: '2028-11-29', deposit_amount: 200000000,
      user_party_role: 'lessee', user_party_relation: 'self', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }],
    },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_payments: [
      pay({ kind: 'deposit', label: '계약금', amount: 20000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-10-10', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
      pay({ kind: 'deposit', label: '잔금', amount: 180000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-11-30', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
      pay({ kind: 'other', label: '보증금 반환 예정', amount: 200000000, frequency: 'one_time', day_of_month: null, starts_on: '2028-11-30', direction: 'expense', direction_basis: 'user', money_nature: 'ordinary' }),
    ],
  });

  // A 급여 카드
  await page.goto(`${BASE}/contract/${jobId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`[data-testid^="salary-"]`, { timeout: 15000 });
  const sal = (await page.locator('[data-testid^="salary-"]').first().getAttribute('data-testid'));
  const card = await text(sal);
  check('A1', '세전 고정 월 급여 3,200,000 · 구성: 기본급 2,800,000 · 고정 직무수당 400,000', card.includes('세전 고정 월 급여') && card.includes('3,200,000원') && card.includes('기본급') && card.includes('2,800,000원') && card.includes('고정 직무수당'), card);
  check('A2', '불일치 경고 없음 (조건부 성과급 때문에 합계 420만이어도)', (await page.locator(tid(`${sal}-check`)).count()) === 0);
  check('A3', '추가 지급 가능: 성과급 최대 1,000,000 · 조건부 · 미확정 · 지급 조건', card.includes('추가 지급 가능 수당') && card.includes('최대 1,000,000원') && card.includes('미확정') && card.includes('분기 목표 달성 시'), card);
  check('A4', '"조건부 수당을 모두 받으면 (예시)" 4,200,000 — 확정 월급 아님', card.includes('(예시)') && card.includes('4,200,000원') && card.includes('확정 월급이 아니라'), card);
  check('A5', '첫 급여 일할: 722,581 · 10월 총 31일 중 7일분 · 2026. 11. 10. 지급 예정 · 세전', card.includes('첫 급여 (일할 계산)') && card.includes('722,581원') && card.includes('10월 총 31일 중 7일분') && card.includes('2026. 11. 10.') && card.includes('세전'), card);
  await shot('01-salary');

  // B 성과급 지급 확정
  await page.click(tid(`${sal}-extra-2-open`));
  await page.fill(`input${tid(`${sal}-extra-2-date`)}`, '2026-12-31');
  await page.fill(`input${tid(`${sal}-extra-2-amount`)}`, '800000');
  await page.click(tid(`${sal}-extra-2-save`));
  await page.waitForTimeout(2000);
  const after = await text(sal);
  check('B1', '성과급 상태 "지급 확정" · 확정 버튼 사라짐', after.includes('지급 확정') && (await page.locator(tid(`${sal}-extra-2-open`)).count()) === 0, after);
  await page.goto(`${BASE}/calendar?date=2026-12-31&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const dec = await text('calendar-month-total');
  check('B2', '12월 입금 예정 4,000,000 (급여 3,200,000 + 확정 성과급 800,000)', dec.includes('4,000,000'), dec);

  // C 보증금 반환 정리
  await page.goto(`${BASE}/contract/${leaseId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid^="deposit-return-fix-"]', { timeout: 15000 });
  const fix = (await page.locator('[data-testid^="deposit-return-fix-"]').first().getAttribute('data-testid'));
  const fixText = await text(fix);
  check('C1', '정리 카드: "보증금 반환 예정"은 보증금 반환으로 보여요 · 반환일 질문', fixText.includes('보증금 반환으로 보여요') && fixText.includes('반환일'), fixText);
  await shot('02-deposit-fix');
  await page.click(tid(`${fix}-at-end`));
  await page.waitForTimeout(2000);
  check('C2', '정리 후 카드 사라짐', (await page.locator('[data-testid^="deposit-return-fix-"]').count()) === 0);
  await page.goto(`${BASE}/calendar?date=2028-11-30&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  const nov = await text('calendar-month-total');
  check('C3', '2028년 11월 총 출금 ₩0 (반환 예정 2억이 지출로 잡히지 않음)', nov.includes('총 출금 예정 ₩0'), nov);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
