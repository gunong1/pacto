/**
 * 분석 대상 페이지 선택 E2E (실제 데이터 모드 · 로컬 Supabase · 가짜 OCR · 서버 mock AI)
 * 2쪽 PDF: 1쪽 = 민감정보 없는 스캔(보호 검증 통과) · 2쪽 = 거의 빈 메모 스캔(글자 인식 불확실)
 * A. 자동 분석 차단 + 페이지별 결과 ("1쪽: 민감정보 감지되지 않음" · "2쪽: 글자 인식 불확실 · 확인 필요") + "2쪽은 글자를 정확하게 읽지 못했어요."
 * B. 문제 페이지에만 [2쪽 미리보기] [이 페이지 제외하고 분석] · 문서 다시 등록 · "확인"만으로 넘어가는 버튼 없음
 * C. 미리보기 = 원본 확인 후 2쪽 열기
 * D. 제외 → 확인 문구("선택한 페이지는 AI 분석에 사용되지 않습니다 …") → 1쪽만으로 분석 → 확인 화면 · 뺀 페이지 안내
 * E. DB: 제외 페이지 [2] · 분석 기록(선택) · AI 요청 1쪽 · 원본 그대로
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

    // A·B
    await page.waitForSelector(tid('gate-protection-pages'), { timeout: 60000 });
    check('A0', '보호 차단 화면(공통): 다시 시도 / 문서 다시 등록 / 직접 입력', (await page.locator(tid('gate-locked-protection')).count()) === 1 && (await page.locator(tid('gate-locked-retry')).count()) === 1);
    await page.waitForTimeout(300);
    await shot('01-gate');
    const gate = await body();
    check('A1', '자동 분석 차단 + "2쪽은 글자를 정확하게 읽지 못했어요."', gate.includes('자동 분석을 진행하지 않았어요') && gate.includes('2쪽은 글자를 정확하게 읽지 못했어요.'));
    const p1 = await page.locator(tid('gate-page-0-1')).innerText();
    const p2 = await page.locator(tid('gate-page-0-2')).innerText();
    check('A2', '페이지별 결과: 1쪽 민감정보 감지되지 않음 · 2쪽 글자 인식 불확실 · 확인 필요', p1.includes('1쪽') && p1.includes('민감정보 감지되지 않음') && p2.includes('2쪽') && p2.includes('글자 인식 불확실 · 확인 필요'), `${p1} / ${p2}`);
    const has = async (id) => (await page.locator(tid(id)).count()) > 0;
    check('B1', '문제 페이지(2쪽)에만 미리보기 · 제외 버튼', (await has('gate-preview-0-2')) && (await has('gate-exclude-0-2')) && !(await has('gate-preview-0-1')) && !(await has('gate-exclude-0-1')));
    check('B2', '"확인"만으로 분석을 진행하는 버튼 없음 · 문서 다시 등록 있음', !/확인했어요|무시하고/.test(gate) && (await has('gate-locked-other')));

    // C. 미리보기 = 원본 확인 후 (웹: 새 탭)
    const nDialogs = dialogs.length;
    // 원본을 여는 짧은 서명 주소 요청 (보호본이 아니라 원본 파일)
    const signed = [];
    const onReq = (r) => /\/object\/sign\/contract-files\//.test(r.url()) && signed.push(r.url());
    context.on('request', onReq);
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }).catch(() => null), page.click(tid('gate-preview-0-2'))]);
    check('C', '2쪽 미리보기: 원본 보기 확인 후 새 창으로 원본을 연다', dialogs.slice(nDialogs).some((m) => m.includes('원본 계약서를 표시합니다')) && !!popup, popup ? popup.url().replace(/\?.*$/, '').slice(-40) : 'no popup');
    if (popup) {
      // 웹은 빈 탭을 먼저 연 뒤 주소를 넣는다 (팝업 차단 방지)
      await popup.waitForURL((u) => u.href !== 'about:blank', { timeout: 15000 }).catch(() => undefined);
      check('C2', '원본 파일(보호본 아님)의 짧은 서명 주소로 연다', signed.some((u) => /\.pdf$/.test(u.split('?')[0]) && !u.includes('protected_view')), `${signed.length}건`);
      await popup.close();
      context.off('request', onReq);
    }

    // D. 제외 → 확인 문구 → 분석
    const before = dialogs.length;
    await page.click(tid('gate-exclude-0-2'));
    await page.waitForSelector(tid('submit-contract'), { timeout: 60000 });
    await page.waitForTimeout(800);
    await shot('02-review');
    check('D1', '제외 확인 문구', dialogs.slice(before).some((m) => m.includes('선택한 페이지는 AI 분석에 사용되지 않습니다. 중요한 계약 내용이 있다면 더 선명한 문서로 다시 등록해주세요.')), dialogs.slice(before).join(' | '));
    const review = await body();
    check('D2', '1쪽만으로 분석 → 확인 화면 · 뺀 페이지 안내(분석 결과가 불완전할 수 있음)', review.includes('2쪽은 분석에 사용하지 않았어요') && review.includes('빠진 내용이 있을 수 있어요'));
    check('D3', '확인 화면 보호 카드에 페이지별 결과', review.includes('1쪽: 민감정보 감지되지 않음') && review.includes('2쪽: 분석에서 제외함'));

    // E. DB
    const [doc] = await admin('/rest/v1/contract_documents?select=id,storage_path,analysis_excluded_pages,protection_status&order=created_at.desc&limit=1');
    const [job] = await admin(`/rest/v1/analysis_jobs?select=validation,raw_output&order=created_at.desc&limit=1`);
    check('E1', 'DB: 제외 페이지 [2] · 문서 상태(남은 1쪽 기준) 민감정보 없음', JSON.stringify(doc.analysis_excluded_pages) === '[2]' && doc.protection_status === 'no_sensitive_data', JSON.stringify(doc));
    check('E2', '분석 기록: 제외 [2] · 분석한 원본 페이지 [1] · AI 요청은 1쪽', job.validation.selection?.length === 1 && job.validation.selection[0].documentId === doc.id && JSON.stringify(job.validation.selection[0].excludedPages) === '[2]' && JSON.stringify(job.validation.selection[0].analyzedPages) === '[1]' && job.raw_output._mock_input[0].pages === 1, JSON.stringify(job.validation.selection));
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
