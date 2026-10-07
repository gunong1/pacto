/**
 * 계약 유형별 E2E (실제 데이터 모드) — 전세 · 월세 · 자동차 할부 · 대출 · 연납 보험 · 일회성(계약금/중도금/잔금)
 * (렌탈은 e2e/rental-scenario.js)
 * 각 계약을 새 계정에 직접 입력으로 저장 → 상세 핵심 정보 · 캘린더 날짜별 일정 · 월 지출을 확인한다.
 * 사용: BASE_URL=http://localhost:8082 node e2e/contract-types.js  (기기 날짜 2026년 10월 기준)
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const log = (...a) => console.log('✔', ...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const CONTRACTS = [
  {
    name: '전세',
    type: 'lease',
    category: 'real_estate',
    title: '전세계약',
    start: '261101',
    end: '281031',
    signed: '260901',
    deposit: '200000000',
    details: [['chip', 'detail-leaseKind-jeonse']],
    payments: [
      { kind: 'deposit', label: '계약금', amount: '20000000', freq: 'one_time', date: '260901' },
      { kind: 'deposit', label: '잔금', amount: '180000000', freq: 'one_time', date: '261101' },
    ],
    dates: [{ kind: 'move_in', label: '입주일', date: '261101' }],
    core: ['보증금', '2억원', '계약금', '잔금', '입주일', '임대차 기간', '계약 체결일'],
    checks: [
      { date: '2026-11-01', has: ['임대차 시작 · 입주', '잔금', '180,000,000원', '지출 합계 제외'], not: ['입주일'], total: '₩0', totalHas: '보증금 1억 8,000만원은 돌려받는 돈이라' },
      { date: '2026-09-01', has: ['계약금'], not: ['계약 체결'], total: '₩0' },
      { date: '2028-09-01', has: ['갱신 여부 확인'] },
      { date: '2028-10-31', has: ['계약 만기'] },
    ],
  },
  {
    name: '월세',
    type: 'lease',
    category: 'real_estate',
    title: '월세계약',
    start: '261101',
    end: '281031',
    deposit: '10000000',
    details: [['chip', 'detail-leaseKind-monthly']],
    payments: [
      { kind: 'deposit', label: '보증금', amount: '10000000', freq: 'one_time' },
      { kind: 'rent', label: '월세', amount: '800000', freq: 'monthly', day: '1' },
      { kind: 'maintenance_fee', label: '관리비', amount: '100000', freq: 'monthly', day: '25' },
    ],
    core: ['보증금', '1,000만원', '월세', '800,000원 · 매월 1일', '관리비'],
    checks: [
      { date: '2026-11-01', has: ['임대차 시작', '보증금', '월세'], total: '₩900,000' },
      { date: '2028-10-25', has: ['관리비'], total: '₩900,000' },
    ],
  },
  {
    name: '자동차 할부',
    type: 'installment',
    category: 'vehicle',
    title: '자동차 할부',
    start: '261020',
    end: '291025',
    details: [['text', 'detail-vehicleName', '아반떼'], ['text', 'detail-principal', '23000000'], ['text', 'detail-interestRate', '4.9']],
    payments: [
      { kind: 'advance_payment', label: '선수금', amount: '5000000', freq: 'one_time', date: '261020' },
      { kind: 'installment', label: '할부금', amount: '683000', freq: 'monthly', day: '25', first: '261125', count: '36' },
    ],
    core: ['할부원금', '23,000,000원', '연 4.9%', '할부금', '남은 회차', '36회 남음', '만기일', '다음 결제'],
    checks: [
      { date: '2026-10-20', has: ['선수금'], total: '₩5,000,000' },
      { date: '2026-11-25', has: ['할부금 1/36회'], total: '₩683,000' },
      { date: '2029-10-25', has: ['할부금 36/36회', '할부 만기'] },
      { date: '2029-11-25', none: true, total: '₩0' },
    ],
  },
  {
    name: '대출',
    type: 'loan',
    category: 'finance',
    title: '신용대출',
    start: '261015',
    end: '311015',
    details: [['text', 'detail-principal', '50000000'], ['text', 'detail-interestRate', '5.2'], ['chip', 'detail-repaymentMethod-equal_payment']],
    payments: [{ kind: 'loan_repayment', label: '월 상환액', amount: '948000', freq: 'monthly', day: '15', first: '261115', count: '60' }],
    core: ['대출원금', '50,000,000원', '연 5.2%', '원리금균등', '월 상환액', '60회 남음', '대출 실행일', '만기일'],
    checks: [
      { date: '2026-10-15', has: ['대출 실행'], total: '₩0' },
      { date: '2026-11-15', has: ['월 상환액 1/60회'], total: '₩948,000' },
      { date: '2031-10-15', has: ['대출 만기', '월 상환액 60/60회'] },
    ],
  },
  {
    name: '연납 보험',
    type: 'insurance',
    category: 'insurance',
    title: '자동차보험',
    start: '261201',
    end: '271130',
    details: [['chip', 'detail-renewable-true'], ['text', 'detail-renewalCycleYears', '1']],
    payments: [{ kind: 'premium', label: '연간 보험료', amount: '1200000', freq: 'yearly' }],
    dates: [{ kind: 'renewal', label: '갱신일', date: '271201' }],
    core: ['연간 보험료', '1,200,000원 · 매년', '보험 기간', '갱신형 · 1년마다', '갱신일'],
    checks: [
      { date: '2026-12-01', has: ['보험 시작', '연간 보험료'], total: '₩1,200,000' },
      { date: '2027-01-01', none: true, total: '₩0' },
      { date: '2027-11-30', has: ['보험 만기'] },
      { date: '2027-12-01', has: ['갱신일'] },
    ],
  },
  {
    name: '일회성(계약금·중도금·잔금)',
    type: 'one_time',
    category: 'business',
    title: '인테리어 공사',
    start: '261010',
    end: '261220',
    details: [['text', 'detail-subject', '아파트 인테리어']],
    payments: [
      { kind: 'down_payment', label: '계약금', amount: '3000000', freq: 'one_time', date: '261010' },
      { kind: 'interim_payment', label: '중도금', amount: '5000000', freq: 'one_time', date: '261115' },
      { kind: 'balance_payment', label: '잔금', amount: '2000000', freq: 'one_time', date: '261220' },
    ],
    core: ['계약 대상', '아파트 인테리어', '계약금', '중도금', '잔금', '계약 완료일'],
    checks: [
      { date: '2026-10-10', has: ['계약금'], total: '₩3,000,000' },
      { date: '2026-11-15', has: ['중도금'], total: '₩5,000,000' },
      { date: '2026-12-20', has: ['잔금', '계약 완료'], total: '₩2,000,000' },
    ],
  },
  {
    name: '근로계약',
    type: 'employment',
    category: 'employment',
    title: '근로계약서',
    start: '261102',
    end: '271101',
    signed: '261020',
    details: [['chip', 'detail-employmentKind-fixed_term'], ['text', 'detail-probationMonths', '3'], ['text', 'detail-workHours', '09:00~18:00']],
    payments: [{ kind: 'salary', label: '월 급여', amount: '3500000', freq: 'monthly', day: '25' }],
    dates: [{ kind: 'hire', label: '입사일', date: '261102' }],
    core: ['고용 형태', '계약직', '월 급여', '+3,500,000원 · 매월 25일', '근로 기간', '수습기간', '3개월', '근무시간'],
    checks: [
      { date: '2026-11-02', has: ['근무 시작'], not: ['입사일'], total: '₩0' },
      { date: '2026-11-25', has: ['월 급여', '+3,500,000원 급여 예정'], total: '₩0', totalHas: '들어올 돈 +₩3,500,000' },
      { date: '2027-11-01', has: ['근로계약 종료'] },
      { date: '2026-10-20', none: true },
    ],
  },
  {
    name: '용역(프리랜서)',
    type: 'service',
    category: 'service',
    title: '앱 디자인 용역',
    start: '261015',
    end: '261231',
    details: [['chip', 'detail-userRole-provider'], ['text', 'detail-workScope', '앱 화면 디자인 20장']],
    payments: [
      { kind: 'down_payment', label: '착수금', amount: '3000000', freq: 'one_time', date: '261015', dir: 'income' },
      { kind: 'balance_payment', label: '잔금', amount: '7000000', freq: 'one_time', date: '261231', dir: 'income' },
    ],
    dates: [{ kind: 'delivery', label: '납기일', date: '261215' }, { kind: 'inspection', label: '검수일', date: '261222' }],
    core: ['나의 역할', '수행자', '업무 내용', '착수금', '+3,000,000원', '납기일', '검수일'],
    checks: [
      { date: '2026-10-15', has: ['업무 시작', '착수금'], total: '₩0', totalHas: '들어올 돈 +₩3,000,000' },
      { date: '2026-12-15', has: ['납기일'] },
      { date: '2026-12-31', has: ['업무 종료', '잔금'], totalHas: '들어올 돈 +₩7,000,000' },
    ],
  },
  {
    name: '매매',
    type: 'sale',
    category: 'sale',
    title: '아파트 매매계약',
    start: '',
    end: '270205',
    signed: '261010',
    total: '200000000',
    details: [['chip', 'detail-userRole-buyer'], ['text', 'detail-subject', '아파트 101동 1203호']],
    payments: [
      { kind: 'down_payment', label: '계약금', amount: '20000000', freq: 'one_time', date: '261010' },
      { kind: 'interim_payment', label: '중도금', amount: '50000000', freq: 'one_time', date: '261130' },
      { kind: 'balance_payment', label: '잔금', amount: '130000000', freq: 'one_time', date: '270131' },
    ],
    dates: [{ kind: 'handover', label: '인도일', date: '270131' }, { kind: 'ownership_transfer', label: '소유권 이전일', date: '270205' }],
    core: ['매수인', '매매 대상', '총 매매금액', '2억원', '계약금', '중도금', '잔금', '인도일', '소유권 이전일'],
    checks: [
      { date: '2026-10-10', has: ['계약금'], not: ['계약 체결'], total: '₩20,000,000' },
      { date: '2026-11-30', has: ['중도금'], total: '₩50,000,000' },
      { date: '2027-01-31', has: ['인도', '잔금'], not: ['인도일'], total: '₩130,000,000' },
      { date: '2027-02-05', has: ['소유권 이전일', '매매 완료'] },
    ],
  },
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [n, k] of CONTRACTS.entries()) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    page.on('pageerror', (e) => errors.push(`${k.name}: ${e.message}`));
    page.on('dialog', (d) => d.accept().catch(() => undefined));
    const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);

    // 새 계정
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`types-${n}-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

    // 직접 입력: 유형 → 기본 → 기간 → 유형별 정보 → 결제 → 주요 날짜
    await page.click(tid('first-run-register'));
    await page.click(tid('method-manual'));
    await page.click(tid(`type-${k.type}`));
    await input('field-title').fill(k.title);
    await page.click(tid(`category-${k.category}`));
    if (k.start) await input('field-startDate').fill(k.start);
    await input('field-endDate').fill(k.end);
    if (k.signed) await input('field-contractDate').fill(k.signed);
    if (k.deposit) await input('field-depositAmount').fill(k.deposit);
    if (k.total) await input('field-totalAmount').fill(k.total);
    for (const [kind, id, value] of k.details) {
      if (kind === 'chip') await page.click(tid(id));
      else await input(id).fill(value);
    }
    for (const [i, p] of k.payments.entries()) {
      await page.click(tid('add-payment'));
      await page.click(tid(`payment-${i}-kind-${p.kind}`));
      await page.click(tid(`payment-${i}-frequency-${p.freq}`));
      await input(`payment-${i}-label`).fill(p.label);
      await input(`payment-${i}-amount`).fill(p.amount);
      if (p.date) await input(`payment-${i}-startsOn`).fill(p.date);
      if (p.first) await input(`payment-${i}-startsOn`).fill(p.first);
      if (p.day) await input(`payment-${i}-dayOfMonth`).fill(p.day);
      if (p.count) await input(`payment-${i}-installmentCount`).fill(p.count);
      if (p.dir) await page.click(tid(`payment-${i}-direction-${p.dir}`));
    }
    for (const [i, d] of (k.dates ?? []).entries()) {
      await page.click(tid('add-date'));
      await page.click(tid(`date-${i}-kind-${d.kind}`));
      await input(`date-${i}-label`).fill(d.label);
      await input(`date-${i}-date`).fill(d.date);
    }
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    await page.waitForTimeout(300);
    const core = await page.locator(tid('contract-detail')).innerText();
    for (const s of k.core) assert(core.includes(s), `${k.name} 상세 핵심 정보에 "${s}" 없음:\n${core.slice(0, 600)}`);
    await page.locator(tid('detail-core')).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `types-${n + 1}-detail.png`) });

    // 캘린더 날짜별 일정 · 월 지출
    for (const c of k.checks) {
      await page.goto(`${BASE}/calendar?date=${c.date}&t=${Date.now()}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(tid('calendar-day-list'), { timeout: 15000 });
      await page.waitForTimeout(300);
      const list = await page.locator(tid('calendar-day-list')).innerText();
      if (c.none) assert(list.includes('이 날은 계약 일정이 없어요'), `${k.name} ${c.date}: 일정이 없어야 함\n${list}`);
      for (const s of c.has ?? []) assert(list.includes(s), `${k.name} ${c.date}: "${s}" 없음\n${list}`);
      for (const s of c.not ?? []) assert(!list.includes(s), `${k.name} ${c.date}: "${s}"가 있으면 안 됨\n${list}`);
      if (c.total) {
        const total = await page.locator(tid('calendar-month-total')).innerText();
        assert(total.includes(c.total), `${k.name} ${c.date.slice(0, 7)} 월 지출 ${c.total} 아님: ${total.replace(/\n/g, ' ')}`);
        if (c.totalHas) assert(total.includes(c.totalHas), `${k.name} ${c.date.slice(0, 7)} 안내 없음: ${total.replace(/\n/g, ' ')}`);
      }
    }
    await page.goto(`${BASE}/calendar?date=${k.checks[0].date}&t=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('calendar-day-list'));
    await page.screenshot({ path: path.join(SHOTS, `types-${n + 1}-calendar.png`) });
    log(`${n + 2}. ${k.name}: 상세 핵심 정보 + 캘린더 ${k.checks.map((c) => `${c.date}${c.total ? `(${c.total})` : ''}`).join(', ')}`);
    await page.close();
  }
  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
