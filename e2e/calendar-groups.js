/**
 * 캘린더 일정 통합 (calendarGroups.ts — 화면 전용). 실제 데이터 모드, 로컬 Supabase · 모든 값은 가짜
 * A 같은 계약·같은 날짜 → 카드 1장 + 관련 일정 펼치기 · B 만기·보증금 반환 확인 · C 핵심 일정/전체 보기 (참고 일정) + 앱 다시 열어도 유지 · D 월 합계 그대로
 * 사용: BASE_URL=http://localhost:8082 node e2e/calendar-groups.js
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
const EMAIL = `calendar-groups-${Date.now()}@pacto.test`;
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  let page = await context.newPage();
  const errors = [];
  const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
  watch(page);
  const text = async (id) => (await page.locator(tid(id)).innerText()).replace(/\s+/g, ' ');
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `calendar-groups-${n}.png`), fullPage: true });

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

  const id = await rpcAsUser({
    p_contract: {
      title: '테스트 전세계약서', contract_kind: 'lease', category: 'real_estate', contract_type: 'lease', start_date: '2026-12-01', end_date: '2028-11-30', deposit_amount: 200000000,
      user_party_role: 'lessee', user_party_relation: 'self', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }],
    },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_dates: [{ kind: 'handover', label: '목적물 인도일', date: '2026-12-01' }, { kind: 'other', label: '계약서 작성일', date: '2026-11-03' }],
    p_payments: [
      pay({ kind: 'deposit', label: '보증금 계약금', amount: 20000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-11-03', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
      pay({ kind: 'deposit', label: '보증금 잔금', amount: 180000000, frequency: 'one_time', day_of_month: null, starts_on: '2026-12-01', direction: 'expense', direction_basis: 'role', money_nature: 'refundable_deposit', fund_key: 'dep' }),
    ],
  });
  const card = `calendar-group-${id}`;

  // A 12/1: 카드 1장 "입주·잔금일" · 잔금 금액 · 관련 일정 3개 펼치기
  await page.goto(`${BASE}/calendar?date=2026-12-01&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid(card), { timeout: 15000 });
  const c1 = await text(card);
  check('A1', '12/1 카드 1장: "입주·잔금일" · 180,000,000원 보증금 지급 · 관련 일정 3개', (await page.locator(tid(card)).count()) === 1 && c1.includes('입주·잔금일') && c1.includes('180,000,000원 보증금 지급') && c1.includes('관련 일정 3개'), c1);
  await page.click(tid(`${card}-toggle`));
  const items = await text(`${card}-items`);
  check('A2', '펼치면 원본 일정 3개: 보증금 잔금 180,000,000원 · 임대차 시작 · 목적물 인도일', items.includes('보증금 잔금') && items.includes('180,000,000원') && items.includes('임대차 시작') && items.includes('목적물 인도일'), items);
  await shot('01-dec1');

  // B 11/30(2028): 만기·보증금 반환 확인
  await page.goto(`${BASE}/calendar?date=2028-11-30&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid(card), { timeout: 15000 });
  const c2 = await text(card);
  check('B1', '만기일 카드: "만기·보증금 반환 확인" (금액 없음)', c2.includes('만기·보증금 반환 확인') && !c2.includes('200,000,000'), c2);

  // C 참고 일정: 핵심 일정에서는 숨김 → 전체 보기에서 보임 → 앱 다시 열어도 전체 보기 유지
  await page.goto(`${BASE}/calendar?date=2026-11-03&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid(card), { timeout: 15000 });
  const core = await text(card);
  const hidden = (await page.locator(tid('calendar-hidden')).count()) ? await text('calendar-hidden') : '';
  check('C1', '핵심 일정: 11/3은 "보증금 계약금 지급"만 · "계약서 작성일" 숨김 안내', core.includes('보증금 계약금 지급') && !core.includes('계약서 작성일') && hidden.includes('참고 일정 1개는 숨겼어요'), `${core} | ${hidden}`);
  await page.click(tid('calendar-mode-all'));
  await page.waitForTimeout(500);
  await page.click(tid(`${card}-toggle`));
  const all = await text(card);
  check('C2', '전체 보기: 계약서 작성일(참고) 함께 보임 · 숨김 안내 없음', all.includes('계약서 작성일') && all.includes('참고') && (await page.locator(tid('calendar-hidden')).count()) === 0, all);
  await page.close();
  page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/calendar?date=2026-11-03&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid(card), { timeout: 15000 });
  await page.waitForTimeout(800);
  check('C3', '앱 다시 열어도 전체 보기 유지', (await text(card)).includes('관련 일정 2개'), await text(card));
  await page.click(tid('calendar-mode-core'));

  // D 월 합계는 보기와 무관
  await page.goto(`${BASE}/calendar?date=2026-12-01&t=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('calendar-month-total'));
  check('D1', '12월 총 출금 예정 ₩180,000,000 (보증금 포함 표시)', (await text('calendar-month-total')).includes('₩180,000,000'), await text('calendar-month-total'));

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})();
