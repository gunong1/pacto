/**
 * 계약서 근거 보기 E2E (실제 데이터 모드 + mock AI: 근로계약서) — 등록 확인 · 계약 상세 · 계약 수정에서 같은 아이콘·시트
 * A. 입력칸 아래에 "원문:" 문장이 늘 보이지 않음
 * B. AI 값에 근거가 있으면 라벨 옆 아이콘 → 시트에 근거 문장(민감정보 가림)·쪽 · "계약서에서 보기"
 * C. 값을 고쳐도 AI가 읽은 값·근거가 시트에 남음 (저장은 고친 값)
 * D. 직접 입력 칸(근거 없음)에는 아이콘 없음
 * E. 상세·수정 화면에서도 같은 아이콘
 * 사용: BASE_URL=http://localhost:8082 node e2e/evidence-view.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (no, name, ok, detail = '') => {
  results.push({ no, name, ok });
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, detail ? `— ${detail}` : '');
};
// 민감정보 없는 실제 PDF (보호가 끝나야 분석)
const PDF = require('./cleanPdf')();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  globalThis.__page = page;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `evidence-${n}.png`), fullPage: true });
  const sheetText = async (icon) => {
    await page.click(tid(icon));
    await page.waitForSelector(tid('evidence-sheet'));
    const t = await page.locator(tid('evidence-sheet')).innerText();
    return t;
  };
  const closeSheet = async () => {
    await page.click(tid('evidence-close'));
    await page.waitForSelector(tid('evidence-sheet'), { state: 'detached' }).catch(() => undefined);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `evidence-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  await page.click(tid('first-run-register'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '근로계약서_네오링크.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForSelector(tid('submit-contract'), { timeout: 40000 });
  await page.waitForTimeout(500);
  await shot('01-review');

  const body = await page.locator('body').innerText();
  check('A', '입력칸 아래에 "원문:" 문장이 늘 보이지 않음', !body.includes('원문:'));

  const s1 = await sheetText('evidence-parties.employer');
  check('B1', '사용자(고용주) 근거 아이콘 → 시트에 근거 문장 · 쪽 · 계약서에서 보기', s1.includes('사용자: 주식회사 네오링크') && s1.includes('계약서 1쪽') && s1.includes('계약서에서 보기'), s1.replace(/\n/g, ' / '));
  await page.waitForTimeout(500); // 열림 애니메이션이 끝난 뒤
  await page.screenshot({ path: path.join(SHOTS, 'evidence-02-sheet.png') });
  await closeSheet();
  const s2 = await sheetText('evidence-parties.employee');
  check('B2', '근로자 근거 문장의 주민등록번호는 가려서 표시', s2.includes('901225-1******') && !s2.includes('1234567'), s2.replace(/\n/g, ' / '));
  await closeSheet();

  // 직접 입력(근거 없는) 칸: 계약 체결일 — 아이콘 없음
  check('D', '근거 없는 칸에는 아이콘 없음 (계약 총액)', (await page.locator(tid('evidence-totalAmount')).count()) === 0);

  // C. 값을 고친 뒤에도 AI 값·근거 유지
  await page.fill(`input${tid('field-parties.employer')}`, '주식회사 네오링크 본사');
  const s3 = await sheetText('evidence-parties.employer');
  check('C', '값을 고쳐도 시트에 AI가 읽은 값 · 근거 문장 유지', s3.includes('AI가 읽은 값: 주식회사 네오링크') && s3.includes('사용자: 주식회사 네오링크'), s3.replace(/\n/g, ' / '));
  await closeSheet();

  // 저장 → 상세
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('03-detail');
  const icons = await page.locator('[data-testid^="evidence-"]').count();
  check('E1', '계약 상세에서도 근거 아이콘 (기본 정보 행)', icons > 0, `${icons}개`);
  if (icons > 0) {
    const s4 = await sheetText('evidence-party:employer');
    check('E2', '상세: 사용자(고용주) 근거 시트 · 저장 값은 고친 값, AI 값 함께', s4.includes('사용자: 주식회사 네오링크') && s4.includes('AI가 읽은 값'), s4.replace(/\n/g, ' / '));
    await closeSheet();
  }

  // 수정 화면
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('submit-contract'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  const editIcon = await page.locator(tid('evidence-parties.employer')).count();
  check('E3', '수정 화면에서도 같은 근거 아이콘', editIcon === 1);
  const editBody = await page.locator('body').innerText();
  check('E4', '수정 화면에도 "원문:" 문장 없음', !editBody.includes('원문:'));
  await shot('04-edit');

  console.log('\npage errors:', errors.length ? errors : 'none');
  await browser.close();
  if (results.some((r) => !r.ok) || errors.length) process.exit(1);
})().catch(async (e) => {
  console.error('✘', e.message.split('\n').slice(0, 6).join(' | '));
  await globalThis.__page?.screenshot({ path: path.join(SHOTS, 'evidence-fail.png'), fullPage: true }).catch(() => undefined);
  process.exit(1);
});
