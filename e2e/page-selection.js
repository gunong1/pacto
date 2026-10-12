/**
 * 읽지 못한 페이지 자동 제외 E2E (실제 데이터 모드 · 로컬 Supabase · 가짜 OCR · 서버 mock AI)
 * 2쪽 PDF: 1쪽 = 민감정보 없는 스캔(보호 검증 통과) · 2쪽 = 거의 빈 메모 스캔(글자 인식 불확실)
 * A. 분석 전 제외 버튼 없이 바로 결과 화면 · 맨 위 안내 "전체 2쪽 중 1쪽만 분석했어요." + 사유 + [제외된 페이지 보기] [문서 다시 등록] · 보호 카드가 보호 완료로 보이지 않음
 * B. 제외된 페이지 보기 = 원본 확인 후 원본 파일
 * C. 최종 저장 전 누락 페이지 확인
 * D. 저장 후 계약 상세에도 부분 분석 이력
 * E. DB: 제외·자동 제외 [2] · 분석 기록(자동 제외·분석 페이지) · AI 요청 1쪽 · 원본 그대로
 * 사용: BASE_URL=http://localhost:8082 node e2e/page-selection.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.join(__dirname, '..');
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (no, name, ok, detail = '') => {
  results.push({ no, name, ok });
  console.log(ok ? '✔' : '✘', `${no}. ${name}`, detail ? `— ${detail}` : '');
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-sel-'));
const make = (kind) => {
  const f = path.join(tmp, `${kind}.pdf`);
  execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), 'make', kind, f], { cwd: ROOT });
  return fs.readFileSync(f);
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const env = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, ''));
const admin = async (p) => {
  const res = await fetch(`${env.API_URL}${p}`, { headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}` } });
  return res.headers.get('content-type')?.includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
};

(async () => {
  const ocr = await require('./fakeOcr')();
  ocr.blankSquare = true;
  const original = make('scan-plain-memo');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const page = await context.newPage();
  globalThis.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => undefined);
  });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `page-selection-${n}.png`), fullPage: true });
  const body = () => page.locator('body').innerText();
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await page.fill(`input${tid('sign-up-email')}`, `pagesel-${Date.now()}@pacto.test`);
    await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
    await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });
    await page.click(tid('first-run-register'));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
    await chooser.setFiles({ name: '헬스장계약서.pdf', mimeType: 'application/pdf', buffer: original });

    // A. 버튼 없이 바로 결과 화면 — 읽지 못한 2쪽은 자동 제외 (분석 전 제외 버튼 화면 없음)
    await page.waitForSelector(tid('submit-contract'), { timeout: 90000 });
    await page.waitForTimeout(800);
    await shot('01-review');
    check('A1', '분석 전에 제외 버튼을 누르는 화면 없이 결과 화면으로', (await page.locator(tid('gate-locked-protection')).count()) === 0);
    const notice = await page.locator(tid('partial-analysis')).innerText().catch(() => '');
    check('A2', '결과 화면 맨 위: "전체 2쪽 중 1쪽만 분석했어요."', notice.includes('전체 2쪽 중 1쪽만 분석했어요.'), notice.replace(/\n/g, ' / '));
    check('A3', '사유: "2쪽은 글자를 정확하게 읽지 못해 분석에서 제외했어요. 중요한 계약 내용이 빠졌을 수 있습니다."', notice.includes('2쪽은 글자를 정확하게 읽지 못해 분석에서 제외했어요. 중요한 계약 내용이 빠졌을 수 있습니다.'));
    check('A4', '[제외된 페이지 보기] [문서 다시 등록]', notice.includes('제외된 페이지 보기') && notice.includes('문서 다시 등록'));
    const box = await page.locator(tid('partial-analysis')).boundingBox();
    const title = await page.locator('text=AI가 정리한 계약정보를').first().boundingBox();
    check('A5', '안내가 결과 화면 맨 위 (제목보다 위)', !!box && !!title && box.y < title.y);
    const review = await body();
    check('A6', '보호 카드가 "보호 완료"로 보이지 않음 ("일부 페이지만 보호했어요" · 2쪽: 글자를 읽지 못해 분석에서 제외함)', review.includes('일부 페이지만 보호했어요') && review.includes('2쪽: 글자를 읽지 못해 분석에서 제외함') && !review.includes('민감정보 보호 완료\n2쪽'));

    // B. 제외된 페이지 보기 = 원본 확인 후 원본 파일
    const signed = [];
    const onReq = (r) => /\/object\/sign\/contract-files\//.test(r.url()) && signed.push(r.url());
    context.on('request', onReq);
    const nDialogs = dialogs.length;
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }).catch(() => null), page.click(tid('partial-analysis-view-0-2'))]);
    await page.waitForTimeout(1500);
    check('B', '제외된 페이지 보기: 원본 보기 확인 후 원본 파일(보호본 아님)을 연다', dialogs.slice(nDialogs).some((m) => m.includes('원본 계약서를 표시합니다')) && !!popup && signed.some((u) => /\.pdf$/.test(u.split('?')[0]) && !u.includes('protected_view')), `${signed.length}건`);
    if (popup) await popup.close();
    context.off('request', onReq);

    // C. 최종 저장 전 확인
    const before = dialogs.length;
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 30000 });
    await page.waitForTimeout(1500);
    const saveDialogs = dialogs.slice(before).join(' | ');
    check('C', '저장 전 누락 페이지 확인 ("2쪽은 분석에 사용하지 않았어요 … 이대로 저장할까요?")', saveDialogs.includes('전체 2쪽 중 1쪽만 분석했어요.') && saveDialogs.includes('2쪽은 분석에 사용하지 않았어요') && saveDialogs.includes('이대로 저장할까요?'), saveDialogs.slice(0, 120));

    // D. 저장 후 계약 상세에도 부분 분석 이력
    await shot('02-detail');
    const detail = await page.locator(tid('detail-partial-analysis')).innerText().catch(() => '');
    check('D', '계약 상세: 부분 분석 이력 (전체 2쪽 중 1쪽만 분석 · 2쪽 자동 제외 사유)', detail.includes('전체 2쪽 중 1쪽만 분석했어요.') && detail.includes('2쪽은 글자를 정확하게 읽지 못해'), detail.replace(/\n/g, ' / '));

    // E. DB
    const [doc] = await admin('/rest/v1/contract_documents?select=id,storage_path,analysis_excluded_pages,analysis_auto_excluded_pages,protection_status&order=created_at.desc&limit=1');
    const [job] = await admin(`/rest/v1/analysis_jobs?select=validation,raw_output&order=created_at.desc&limit=1`);
    check('E1', 'DB: 제외 [2] · 자동 제외 [2]', JSON.stringify(doc.analysis_excluded_pages) === '[2]' && JSON.stringify(doc.analysis_auto_excluded_pages) === '[2]', JSON.stringify(doc));
    const sel = job.validation.selection?.[0] ?? {};
    check('E2', '분석 기록: 자동 제외 [2] · 분석한 원본 페이지 [1] · AI 요청은 1쪽', sel.documentId === doc.id && JSON.stringify(sel.autoExcludedPages) === '[2]' && JSON.stringify(sel.analyzedPages) === '[1]' && job.raw_output._mock_input[0].pages === 1, JSON.stringify(sel));
    const stored = await admin(`/storage/v1/object/contract-files/${doc.storage_path}`);
    check('E3', '원본 PDF 그대로 (해시 같음)', sha(stored) === sha(original));
  } finally {
    console.log('\npage errors:', errors.length ? errors : 'none');
    await browser.close();
    await ocr.close();
  }
  if (results.some((r) => !r.ok) || errors.length) process.exit(1);
})().catch(async (e) => {
  console.error('✘', e.message.split('\n').slice(0, 6).join(' | '));
  await globalThis.__page?.screenshot({ path: path.join(SHOTS, 'page-selection-fail.png'), fullPage: true }).catch(() => undefined);
  process.exit(1);
});
