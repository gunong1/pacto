/**
 * 직접 입력 계약 수정 = 등록과 같은 화면 (빠른 입력 + "상세 정보 추가")
 * A 등록 → 수정: 같은 구성(계약명·유형·금액·금액 구분·주기·결제일 / 선택 / 상세 정보 추가), 저장한 값이 채워짐, 상세 정보 접힘
 * B 금액·결제일·금액 구분 수정 → "수정 완료" → 상세에 반영
 * C 상세 정보(상대방)가 있는 계약 → 수정 화면에서 상세 정보가 처음부터 펼쳐짐
 * D 계약서로 등록한 계약은 기존 전체 수정 화면
 * 사용: `npm run web`(mock 모드) 실행 후 BASE_URL=http://localhost:8081 node e2e/quick-edit.js
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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;
  const selected = async (prefix) => {
    for (const el of await page.locator(`[data-testid^="${prefix}-"][aria-selected="true"]`).all()) return (await el.getAttribute('data-testid')).slice(prefix.length + 1);
    return null;
  };
  const toMain = async () => {
    for (let i = 0; i < 4 && !(await page.locator(tid('tab-add')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(300);
    }
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));

  // A 등록
  await page.click(tid('tab-add'));
  await page.click(tid('method-manual'));
  await page.waitForSelector(tid('quick-basic'));
  await input('field-title').fill('넷플릭스 프리미엄');
  await input('quick-amount').fill('17000');
  await input('quick-day').fill('12');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });

  // 수정 화면
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('quick-basic'), { timeout: 10000 });
  await page.waitForTimeout(400);
  const same = ['field-title', 'kind-chooser', 'quick-amount', 'quick-direction-expense', 'quick-frequency-monthly', 'quick-day', 'field-startDate', 'field-endDate', 'field-autoRenewal', 'field-memo', 'toggle-more'];
  const missing = [];
  for (const id of same) if (!(await has(id))) missing.push(id);
  check('A1', '수정 화면 = 등록과 같은 구성 (계약명·유형·금액·금액 구분·주기·결제일·시작/종료·자동갱신·메모·상세 정보 추가)', missing.length === 0, missing.join(','));
  const pay = await page.locator(tid('quick-payment')).innerText();
  check('A2', '같은 라벨: "금액" · "금액 구분" · "결제 주기" · "결제일" (다음 결제일 아님)', pay.startsWith('금액') && pay.includes('금액 구분') && pay.includes('결제 주기') && pay.includes('결제일') && !pay.includes('다음 결제일'));
  check(
    'A3',
    '저장한 값이 채워짐 (넷플릭스 프리미엄 · 17,000 · 지출 · 매월 · 12일)',
    (await input('field-title').inputValue()) === '넷플릭스 프리미엄' && (await input('quick-amount').inputValue()) === '17,000' && (await selected('quick-direction')) === 'expense' && (await selected('quick-frequency')) === 'monthly' && (await input('quick-day').inputValue()) === '12',
  );
  check('A4', '상세 정보가 없으면 접힌 상태', !(await has('quick-more')) && !(await has('field-counterparty')));
  const title = await page.title();
  const submit = await page.locator(tid('submit-contract')).innerText();
  check('A5', '제목 "계약 정보 수정" · 버튼 "수정 완료"', (await page.locator('body').innerText()).includes('계약 정보 수정') && submit.includes('수정 완료'), `${title} / ${submit}`);
  await page.screenshot({ path: path.join(SHOTS, 'quick-edit-01.png'), fullPage: true });

  // B 수정
  await input('quick-amount').fill('13500');
  await input('quick-day').fill('20');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(400);
  const detail = await page.locator('body').innerText();
  check('B', '"수정 완료" → 상세에 13,500원 · 20일 반영', detail.includes('13,500') && /20일/.test(detail), detail.replace(/\s+/g, ' ').slice(0, 300));

  // C 상세 정보 있는 계약 → 펼친 상태로 열림
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('quick-basic'));
  await page.click(tid('toggle-more'));
  await input('field-counterparty').fill('넷플릭스코리아');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('quick-basic'));
  await page.waitForTimeout(400);
  check('C', '상세 정보(상대방)가 있으면 수정 화면에서 처음부터 펼침 · 값 유지', (await has('quick-more')) && (await input('field-counterparty').inputValue()) === '넷플릭스코리아' && (await input('quick-amount').inputValue()) === '13,500');
  await page.screenshot({ path: path.join(SHOTS, 'quick-edit-02-more.png'), fullPage: true });

  // D 계약서로 등록한 계약(미리보기 예시 데이터) → 전체 수정 화면
  await toMain();
  await page.click(tid('tab-contracts'));
  await page.waitForSelector(tid('contracts-list'));
  await page.locator('[data-testid^="contract-row-"]', { hasText: '자동차보험' }).first().click();
  await page.waitForSelector(tid('edit-contract'));
  await page.click(tid('edit-contract'));
  await page.waitForTimeout(800);
  check('D', '계약서로 등록한 계약은 기존 전체 수정 화면 (빠른 입력 아님)', (await has('section-type')) && !(await has('quick-basic')));

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
