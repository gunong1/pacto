/**
 * 민감정보 보호 E2E (실제 데이터 모드 · 로컬 Supabase · 서버 mock AI의 근로계약 예시)
 * 업로드 → 민감정보 보호(서버) → 분석 → 확인 화면 보호 카드 → 저장 → 보호된 계약서 보기(기본) / 원본 보기(확인 후)
 * → 가리기 해제 → 스캔본은 "지원하지 않아요" → 계약 삭제 시 원본·보호본·기록 정리
 * 테스트 D·E·F·H를 실제 화면·저장소·DB로 확인한다.
 * 사용: BASE_URL=http://localhost:8082 node e2e/protection-flow.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync, execSync } = require('child_process');
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-e2e-'));
const cli = (...a) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...a], { cwd: ROOT, encoding: 'utf8' });
const make = (kind) => {
  const f = path.join(tmp, `${kind}.pdf`);
  cli('make', kind, f);
  return fs.readFileSync(f);
};
const pdfText = (buf) => {
  const f = path.join(tmp, `${Date.now()}-${Math.random()}.pdf`);
  fs.writeFileSync(f, buf);
  return cli('text', f).replace(/\s+/g, '');
};
const env = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, ''));
const admin = async (p, init = {}) => {
  const res = await fetch(`${env.API_URL}${p}`, { ...init, headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  return res.json();
};
const SECRETS = ['901225-1234567', '1234567', '123456-01-234567', '01-234567'];
const leaks = (text) => SECRETS.filter((s) => text.includes(s));

(async () => {
  const original = make('employment');
  const scan = make('scan');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: Number(process.env.VIEWPORT_HEIGHT || 844) }, locale: 'ko-KR' });
  const page = await context.newPage();
  globalThis.__page = page;
  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && !(r.status() === 403 && r.url().endsWith('/analyze-contract')) && errors.push(`http ${r.status()} ${r.url().slice(0, 120)}`));
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => undefined);
  });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `protection-${n}.png`), fullPage: true });
  const body = () => page.locator('body').innerText();

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  const email = `protect-${Date.now()}@pacto.test`;
  await page.fill(`input${tid('sign-up-email')}`, email);
  await page.fill(`input${tid('sign-up-password')}`, 'pacto-ui-password-1');
  await page.fill(`input${tid('sign-up-confirm')}`, 'pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // 업로드 화면 안내 문구
  await page.click(tid('first-run-register'));
  await page.waitForSelector(tid('method-pdf'));
  const uploadCopy = await body();
  check('U', '업로드 화면: 지원되는 PDF에서만 가린다고 안내 (사진까지 가리는 것처럼 쓰지 않음, 단정 표현 없음)', uploadCopy.includes('지원되는 PDF에서는 민감정보를') && !/100%|완벽하게|자동으로 보호됩니다/.test(uploadCopy));

  // 업로드 → 보호 → 분석
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await chooser.setFiles({ name: '근로계약서_네오링크.pdf', mimeType: 'application/pdf', buffer: original });
  await page.waitForSelector(tid('analyzing-phase-protect'), { timeout: 20000 }).catch(() => undefined);
  const phases = await page.locator(tid('analyzing-stages')).innerText().catch(() => '');
  check('S', '분석 단계: 계약서 보관 → 민감정보 보호 → 문서 확인·계약 분석 → 계약정보 정리 (실제 순서)', /계약서 보관[\s\S]*민감정보 보호[\s\S]*문서 확인·계약 분석[\s\S]*계약정보 정리/.test(phases), phases.replace(/\n/g, ' / '));
  await page.waitForSelector(tid('review-protection-0'), { timeout: 40000 });
  await page.waitForTimeout(500);
  await page.click(tid('review-protection-0-toggle'));
  const card = await page.locator(tid('review-protection-0')).innerText();
  await page.locator(tid('review-protection-0')).screenshot({ path: path.join(SHOTS, 'protection-01-review-card.png') });
  await shot('01-review');
  check('A', '확인 화면: 민감정보를 보호했어요 · 3건 · 주민번호/연락처/이메일 가린 값', card.includes('민감정보를 보호했어요') && card.includes('주민등록번호 1건 · 연락처 1건 · 이메일 1건') && card.includes('자동으로 찾아 가려서 표시합니다.') && card.includes('901225-1******') && card.includes('010-****-5678'), card.split('\n').slice(0, 4).join(' / '));
  const reviewText = await body();
  check('H', 'AI 인용문·설명의 주민등록번호·계좌번호도 화면에서 가림', leaks(reviewText).length === 0 && reviewText.includes('901225-1******'), leaks(reviewText).join(','));
  const val = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`).first().inputValue().catch(() => "");
  const [cp, emp, amt] = [await val('field-counterparty'), await val('detail-employeeName'), await val('payment-0-amount')];
  check('A2', '이름·회사·급여는 계약 분석에 그대로 사용 (입력값)', cp === '주식회사 네오링크' && emp === '박민준' && amt === '3,600,000', `${cp} / ${emp} / ${amt}`);

  // 저장 → 상세
  await page.click(tid('submit-contract'));
  await page.waitForSelector(tid('detail-open-document'), { timeout: 15000 });
  const head = await page.locator(tid('detail-open-document')).innerText();
  check('V', '상세: 기본은 "보호된 계약서 보기"', head.includes('보호된 계약서 보기') && head.includes('민감정보를 보호했어요'), head.replace(/\n/g, ' / '));
  await shot('02-detail');

  // D·F: 기본 보기 = 보호본 (원문 추출 안 됨), 원본 보기 = 확인 후 원본 그대로
  const grab = async (click) => {
    const [req] = await Promise.all([
      context.waitForEvent('request', { predicate: (r) => r.method() === 'GET' && r.url().includes('/storage/v1/object/sign/contract-files/'), timeout: 15000 }),
      click(),
    ]);
    const buf = Buffer.from(await (await context.request.get(req.url())).body());
    for (const p of context.pages()) if (p !== page) await p.close();
    return { url: req.url(), buf };
  };
  const view = await grab(() => page.click(tid('detail-open-document')));
  const viewText = pdfText(view.buf);
  check('F', '보호본: protected_view 파일 · 텍스트 추출에 원문 없음 · 계약 정보 유지', view.url.includes('.protected_view.pdf') && leaks(viewText).length === 0 && viewText.includes('901225-1') && viewText.includes('3,600,000원'), leaks(viewText).join(','));
  const before = dialogs.length;
  const docId = (await page.locator('[data-testid^="protection-"][data-testid$="-original"]').first().getAttribute('data-testid')).replace(/^protection-/, '').replace(/-original$/, '');
  const orig = await grab(() => page.click(tid(`protection-${docId}-original`)));
  check('D', '원본 보기: 확인 문구 후 원본 그대로 (업로드한 파일과 동일)', dialogs.slice(before).some((m) => m.includes('원본 계약서를 표시합니다') && m.includes('민감정보가 포함되어 있을 수 있습니다')) && Buffer.compare(orig.buf, original) === 0 && !orig.url.includes('protected_view'));

  // 가리기 해제 → 보호본 다시 생성
  await page.click(tid(`protection-${docId}-toggle`));
  await page.click(tid(`protection-${docId}-region-phone-toggle`));
  await page.waitForFunction((id) => document.querySelector(`[data-testid="protection-${id}-region-phone"]`)?.textContent?.includes('표시'), docId, { timeout: 20000 });
  const view2 = pdfText((await grab(() => page.click(tid('detail-open-document')))).buf);
  check('R', '연락처 가리기 해제 → 보호본에 연락처만 표시, 주민번호는 계속 가림', view2.includes('010-1234-5678') && leaks(view2).length === 0);
  await page.locator(tid('detail-documents')).screenshot({ path: path.join(SHOTS, 'protection-03-detail-documents.png') });

  // H: DB에 저장된 AI 결과(분석 기록·계약 체크)에도 원문 없음
  const userId = (await admin(`/auth/v1/admin/users?per_page=200`)).users.find((u) => u.email === email).id;
  const contracts = await admin(`/rest/v1/contracts?select=id,ai_checks&user_id=eq.${userId}`);
  const jobs = await admin(`/rest/v1/analysis_jobs?select=result&user_id=eq.${userId}`);
  const regions = await admin(`/rest/v1/document_sensitive_regions?select=*&user_id=eq.${userId}`);
  const dbText = JSON.stringify([contracts, jobs, regions]);
  check('H2', 'DB(ai_checks·analysis_jobs.result·민감정보 영역)에 원문 없음', leaks(dbText).length === 0 && dbText.includes('901225-1******'), leaks(dbText).join(','));

  // 로그(브라우저 콘솔)에도 원문 없음
  check('L', '앱 로그에 원문 없음', leaks(logs.join('\n')).length === 0);

  // 스캔본: 지원하지 않음 (보호됨으로 표시하지 않음)
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('method-pdf'))]);
  await c2.setFiles({ name: '스캔계약서.pdf', mimeType: 'application/pdf', buffer: scan });
  await page.waitForSelector(tid('review-protection-0'), { timeout: 40000 });
  const scanCard = await page.locator(tid('review-protection-0')).innerText();
  await page.locator(tid('review-protection-0')).screenshot({ path: path.join(SHOTS, 'protection-04-scan-card.png') });
  check('S2', '스캔본: "스캔된 페이지가 포함되어 있어 자동 가리기를 지원하지 않아요." (보호했어요와 구분)', scanCard.includes('스캔된 페이지가 포함되어 있어 자동 가리기를 지원하지 않아요.') && !scanCard.includes('보호했어요'), scanCard.split('\n')[0]);

  // E: 계약 삭제 → 원본·보호본·기록 정리
  const contractId = contracts[0].id;
  await page.goto(`${BASE}/contract/${contractId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(tid('delete-contract'), { timeout: 15000 });
  await page.click(tid('delete-contract'));
  await page.waitForTimeout(2500);
  const files = await admin(`/storage/v1/object/list/contract-files`, { method: 'POST', body: JSON.stringify({ prefix: userId, limit: 100 }) });
  const leftover = files.filter((f) => f.name.startsWith(docId));
  const regionsAfter = await admin(`/rest/v1/document_sensitive_regions?select=id&document_id=eq.${docId}`);
  const derivAfter = await admin(`/rest/v1/document_derivatives?select=id&document_id=eq.${docId}`);
  check('E', '계약 삭제: 원본·보호본 파일, 민감정보 영역·파생본 기록 모두 정리', leftover.length === 0 && regionsAfter.length === 0 && derivAfter.length === 0, `파일 ${leftover.length} · 영역 ${regionsAfter.length} · 파생본 ${derivAfter.length}`);

  console.log('\npage errors:', errors.length ? errors : 'none');
  fs.writeFileSync(path.join(SHOTS, 'protection-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  if (results.some((r) => !r.ok) || errors.length) process.exit(1);
})().catch(async (e) => {
  console.error('✘', e.message);
  await globalThis.__page?.screenshot({ path: path.join(SHOTS, 'protection-fail.png'), fullPage: true }).catch(() => undefined);
  process.exit(1);
});
