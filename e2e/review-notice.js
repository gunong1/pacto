/**
 * 등록 확인 화면: 갱신·통보 기한 입력칸 없이 계약 체크에서 넣기 (실제 데이터 모드 + 서버 mock 렌탈 예시, 모든 값은 가짜)
 * A 확인 화면에 "갱신 · 해지" 입력(자동갱신·통보기한·중도해지·위약금)이 없음 · AI가 찾은 기한은 그대로 저장
 * B 기한을 못 찾음(계약 체크의 "종료 30일 전"만) → 자동갱신 체크 카드에 "이 기한을 캘린더·알림에 넣을까요? [30일 전 넣기]"
 * C 넣지 않고 저장하면 통보기한 없음 / 넣고 저장하면 해지 통보기한 2029. 9. 11.
 * D 수정 화면: "+ 상세 정보"를 펼치면 자동갱신·통보 기한을 고칠 수 있음
 * 사용: BASE_URL=http://localhost:8082 node e2e/review-notice.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const check = (no, name, ok, detail = '') => {
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, !ok && detail ? `— ${detail}` : '');
  if (!ok) process.exitCode = 1;
};
// 민감정보 없는 실제 PDF (빈 PDF는 보호를 마치지 못해 분석하지 않음 — fail-closed)
const PDF = require('./cleanPdf')();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `review-notice-${n}.png`), fullPage: true });
  const has = async (id) => (await page.locator(tid(id)).count()) > 0;

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await page.fill(`input${tid('sign-up-email')}`, `review-notice-${Date.now()}@pacto.test`);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  const upload = async (name) => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
    await chooser.setFiles({ name, mimeType: 'application/pdf', buffer: PDF });
    await page.waitForSelector(tid('submit-contract'), { timeout: 30000 });
    await page.waitForTimeout(500);
  };
  const noticeCard = () => page.locator('[data-testid^="review-check-"][data-testid$="-notice"]');
  const noticeAdd = () => page.locator('[data-testid^="review-check-"][data-testid$="-notice-add"]');

  // A 확신 있는 기한 (렌탈 예시: 통보기한 30일)
  await upload('정수기_렌탈_계약서.pdf');
  const gone = ['field-autoRenewal', 'field-terminationNoticeDays', 'notice-kind', 'field-earlyTerminationTerms', 'field-penaltyTerms', 'section-renewal', 'toggle-renewal'];
  const shown = [];
  for (const id of gone) if (await has(id)) shown.push(id);
  check('A1', '확인 화면에 갱신·해지 입력(자동갱신·통보기한·의미·중도해지·위약금) 없음', shown.length === 0, shown.join(', '));
  const checks1 = (await page.locator(tid('review-checks')).innerText()).replace(/\s+/g, ' ');
  check('A2', 'AI가 찾은 기한 → 버튼 없이 "저장하면 캘린더와 알림에 자동으로 추가돼요" (2029. 9. 11.)', (await noticeCard().count()) === 0 && checks1.includes('저장하면 캘린더와 알림에 자동으로 추가돼요') && checks1.includes('2029. 9. 11.'), checks1.slice(0, 300));
  await shot('01-review-confident');
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const core0 = (await page.locator(tid('detail-core')).innerText()).replace(/\s+/g, ' ');
  check('A3', '저장 → 자동갱신·통보기한(2029. 9. 11.)이 AI 값 그대로 저장', core0.includes('자동갱신 있음') && core0.includes('2029. 9. 11.'), core0.slice(0, 300));

  // B 기한 일수를 못 찾음 (계약 체크의 "종료 30일 전"만 있음)
  const unsure = '정수기_렌탈_통보미확인.pdf';
  await upload(unsure);
  const card = (await noticeCard().count()) ? (await noticeCard().first().innerText()).replace(/\s+/g, ' ') : '';
  check('B', '확인이 필요한 기한 → 자동갱신 체크 카드에 "이 기한을 캘린더·알림에 넣을까요? [30일 전 넣기]" (1곳)', (await noticeCard().count()) === 1 && card.includes('이 기한을 캘린더·알림에 넣을까요?') && card.includes('30일 전 넣기'), card);
  await page.locator(tid('review-checks')).screenshot({ path: path.join(SHOTS, 'review-notice-02-card.png') });

  // C-1 넣지 않고 저장
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const core1 = (await page.locator(tid('detail-core')).innerText()).replace(/\s+/g, ' ');
  check('C1', '넣지 않고 저장 → 통보기한 없음', !core1.includes('2029. 9. 11.') && !core1.includes('30일 전'), core1.slice(0, 300));

  // C-2 넣고 저장
  await upload(unsure);
  await noticeAdd().first().click();
  const card2 = (await noticeCard().first().innerText()).replace(/\s+/g, ' ');
  const checks2 = (await page.locator(tid('review-checks')).innerText()).replace(/\s+/g, ' ');
  check('C2', '버튼 → "✓ 30일 전 넣었어요" + 기한 날짜 2029. 9. 11.', card2.includes('30일 전 넣었어요') && checks2.includes('2029. 9. 11.'), `${card2} / ${checks2.slice(0, 200)}`);
  await page.locator(tid('review-checks')).screenshot({ path: path.join(SHOTS, 'review-notice-03-picked.png') });
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
  const core2 = (await page.locator(tid('detail-core')).innerText()).replace(/\s+/g, ' ');
  check('C3', '저장 → 통보기한 30일 전(2029. 9. 11.) 저장', core2.includes('2029. 9. 11.'), core2.slice(0, 300));

  // D 수정 화면
  await page.click(tid('edit-contract'));
  await page.waitForSelector(tid('submit-contract'), { timeout: 10000 });
  const before = await has('field-terminationNoticeDays');
  await page.click(tid('toggle-renewal'));
  const days = await page.locator(`input${tid('field-terminationNoticeDays')}`).inputValue();
  const sw = await has('field-autoRenewal');
  await page.locator(tid('section-renewal')).screenshot({ path: path.join(SHOTS, 'review-notice-04-edit.png') });
  check('D', '수정 화면: 처음엔 접힘 → "+ 상세 정보"에서 자동갱신·통보기한(30) 수정 가능', !before && days === '30' && sw, `${before} ${days} ${sw}`);

  check('Z', '페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
