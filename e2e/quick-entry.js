/**
 * 직접 입력(빠른 입력) — 문서 없는 계약을 가계부처럼 30초 안에 등록
 * A 기본 화면: 계약명·유형·금액·결제 주기·다음 결제일 + 선택(시작·종료·자동갱신·메모)만, 상세 정보는 접혀 있음
 * B "유튜브 프리미엄 · 월 14,900원 · 다음 결제일 · 자동갱신 ON"만 입력해 저장 → 상세에 매월 결제로 표시
 * C "+ 상세 정보 추가" → 상대방·체결일·통보기한·주요 날짜·위약금·종료 메모·기타 조건 펼침
 * D 금액만 넣고 날짜를 비우면 저장되지 않고 안내
 * F 분야 추천: 계약명 → "구독으로 분류했어요 [추천] 변경", 애매하면 추천 없음(기타), 직접 고르면 그 값 유지
 * 사용: `npm run web`(mock 모드) 실행 후 `node e2e/quick-entry.js`
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (id, name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const kst = (n) => {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;
  // mock 모드는 새로고침하면 로그인이 풀리므로 탭으로 이동한다
  const openManual = async () => {
    // 상세 화면 등 탭이 가려진 화면이면 뒤로
    for (let i = 0; i < 3 && !(await page.locator(tid('tab-add')).isVisible().catch(() => false)); i++) {
      await page.goBack();
      await page.waitForTimeout(400);
    }
    if (!(await page.locator(tid('tab-add')).isVisible().catch(() => false))) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.click(tid('signin-apple'));
      await page.waitForSelector(tid('home-spending-total'));
    }
    await page.click(tid('tab-add'));
    await page.click(tid('method-manual'));
    await page.waitForSelector(tid('quick-basic'));
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-apple'));
  await page.waitForSelector(tid('home-spending-total'));

  // A
  await openManual();
  await page.screenshot({ path: path.join(SHOTS, 'quick-01-form.png'), fullPage: true });
  const visible = ['field-title', 'type-recurring', 'quick-amount', 'quick-frequency-monthly', 'quick-nextDate', 'field-startDate', 'field-endDate', 'field-autoRenewal', 'field-memo'];
  const hidden = ['field-counterparty', 'field-contractDate', 'field-terminationNoticeDays', 'add-date', 'field-penaltyTerms', 'field-earlyTerminationTerms', 'field-totalAmount', 'add-payment'];
  const missing = [];
  for (const id of visible) if (!(await has(id))) missing.push(id);
  const shown = [];
  for (const id of hidden) if (await has(id)) shown.push(id);
  check('A', '기본 화면은 주요·선택 항목만, 상세 정보는 접힘', missing.length === 0 && shown.length === 0, `없음 ${missing} / 보임 ${shown}`);
  // 선택된 유형의 예시 문구가 보인다 (월 납입형: 렌탈 · 통신 · 헬스장 · 구독 …)
  check('A2', '계약 유형 기본값 = 월 납입형', (await page.locator(tid('quick-basic')).innerText()).includes('헬스장 · 구독'));

  // B
  const t0 = Date.now();
  await input('field-title').fill('유튜브 프리미엄');
  await input('quick-amount').fill('14900');
  await input('quick-nextDate').fill(kst(3));
  await input('quick-nextDate').blur();
  await page.click(tid('field-autoRenewal'));
  const period = await input('field-renewalPeriodMonths').inputValue();
  check('B1', '자동갱신을 켜면 갱신 주기가 결제 주기(1개월)로 미리 채워짐', period === '1', period);
  await page.screenshot({ path: path.join(SHOTS, 'quick-02-filled.png'), fullPage: true });
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const elapsed = Date.now() - t0;
  const core = await page.locator('body').innerText();
  check('B2', `4개 입력만으로 저장 (스크립트 입력 ${elapsed}ms)`, true);
  check('B3', '상세에 14,900원 결제 표시', core.includes('14,900'), core.slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, 'quick-03-detail.png'), fullPage: true });

  // C
  await openManual();
  await page.click(tid('toggle-more'));
  const revealed = [];
  for (const id of hidden) if (!(await has(id))) revealed.push(id);
  check('C', '"상세 정보 추가" → 숨긴 항목이 모두 펼쳐짐', revealed.length === 0, `안 보임 ${revealed}`);
  await page.screenshot({ path: path.join(SHOTS, 'quick-04-more.png'), fullPage: true });
  await page.click(tid('toggle-more'));
  check('C2', '다시 누르면 접힘', !(await has('field-counterparty')));

  // D
  await input('field-title').fill('넷플릭스');
  await input('quick-amount').fill('17000');
  await page.click(tid('submit-contract'));
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();
  check('D', '금액만 있고 다음 결제일이 없으면 저장하지 않고 안내', body.includes('다음 결제일을 입력해주세요') && !(await has('detail-core')));

  // F 분야 추천
  await openManual();
  const line = async () => ((await has('category-suggestion-text')) ? (await page.locator(tid('category-suggestion-text')).innerText()).trim() : null);
  await input('field-title').fill('넷플릭스');
  await page.waitForTimeout(200);
  const l1 = await line();
  check('F1', '넷플릭스 → "구독으로 분류했어요" + 추천', l1 === '구독으로 분류했어요' && (await page.locator(tid('category-suggestion-line')).innerText()).includes('추천'), String(l1));
  await input('field-title').fill('SKT 유튜브 결합');
  await page.waitForTimeout(200);
  check('F2', '두 분야가 섞이면 추천 안 함 (기타 유지)', (await line()) === null);
  await input('field-title').fill('헬스장 PT');
  await page.waitForTimeout(200);
  check('F3', '헬스장 PT → 회원권으로 분류', (await line()) === '회원권으로 분류했어요', String(await line()));
  await page.click(tid('category-change'));
  await page.click(tid('quick-category-education'));
  await page.waitForTimeout(200);
  check('F4', '변경 → 교육 선택 → "분야: 교육" (추천 표시 없음)', (await line()) === '분야: 교육' && !(await page.locator(tid('category-suggestion-line')).innerText()).includes('추천'), String(await line()));
  await input('field-title').fill('넷플릭스 헬스');
  await input('field-title').fill('넷플릭스');
  await page.waitForTimeout(200);
  check('F5', '직접 고른 뒤에는 계약명을 바꿔도 그대로', (await line()) === '분야: 교육', String(await line()));
  await page.click(tid('toggle-more'));
  check('F6', '상세 정보에서도 분야 변경 가능', await has('category-subscription'));
  await page.click(tid('category-subscription'));
  await page.waitForTimeout(200);
  check('F7', '상세에서 고른 값이 위 줄에도 반영', (await line()) === '분야: 구독', String(await line()));
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const head = await page.locator('body').innerText();
  check('F8', '저장 → 상세에 분야 구독', head.includes('구독'), head.slice(0, 120));

  check('E', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
