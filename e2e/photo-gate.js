/**
 * 사진으로 등록 — 문서 확인 게이트 E2E (실제 데이터 모드 + mock AI: 파일 이름으로 시나리오)
 * 1) 사진 등록 시트(지금 촬영하기 / 앨범에서 선택)
 * 2) 음식 사진 → "계약서로 확인하기 어려워요" · 확인 화면으로 가지 않음 · 보관본 정리
 * 3) 해상도가 너무 낮은 사진 → 업로드 전에 "계약 내용을 읽기 어려워요"
 * 4) 계약서 4장 + 책상 사진 → 3번째 사진 제외 → 확인 화면에 그 사진의 3,000,000원이 없음
 * 5) 직접 촬영(웹에서는 파일 선택으로 대신) → 촬영 목록 · 삭제 · 촬영 완료 → 분석
 * 사용: BASE_URL=http://localhost:8082 node e2e/photo-gate.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8082';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;
const results = [];
const check = (id, name, ok, detail = '') => {
  results.push({ id, name, ok });
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => undefined));
  const input = (id) => page.locator(`input${tid(id)}`);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `photo-${n}.png`) });
  const body = () => page.locator('body').innerText();

  // 테스트 이미지 (브라우저 캔버스로 생성 — 저장소에 이미지 파일을 두지 않는다)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const jpeg = async (w, h, dark, seed = 0) =>
    Buffer.from(
      (await page.evaluate(
        ([w, h, dark, seed]) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = dark ? '#8a6a4a' : '#fafaf5';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#333';
          for (let y = 60; y < h - 60; y += 36) g.fillRect(60, y, w - 120 - ((y * (seed + 1)) % 200), 4);
          return c.toDataURL('image/jpeg', 0.85).split(',')[1];
        },
        [w, h, dark, seed],
      )),
      'base64',
    );
  const doc = await jpeg(1200, 1600, false);
  const docs = await Promise.all([1, 2, 3, 4].map((i) => jpeg(1200, 1600, false, i)));
  const desk = await jpeg(1200, 1600, true);
  const small = await jpeg(400, 300, false);
  const pick = async (files, trigger) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid(trigger))]);
    await chooser.setFiles(files.map(([name, buffer]) => ({ name, mimeType: 'image/jpeg', buffer })));
  };
  const openAlbum = async (files) => {
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    await page.click(tid('method-photo'));
    await page.waitForSelector(tid('photo-sheet'));
    await pick(files, 'photo-album');
  };

  // 가입
  await page.click(tid('signin-email'));
  await page.click(tid('go-sign-up'));
  await input('sign-up-email').fill(`photo-${Date.now()}@pacto.test`);
  await input('sign-up-password').fill('pacto-ui-password-1');
  await input('sign-up-confirm').fill('pacto-ui-password-1');
  await page.click(tid('consent-terms'));
  await page.click(tid('consent-privacy'));
  await page.click(tid('sign-up-submit'));
  await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

  // 1) 등록 화면: 사진으로 등록 → 시트
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  const method = await body();
  check('M', '등록 화면: "사진으로 등록 · 종이 계약서를 촬영하거나 사진 선택", 하단 문구는 PDF만 가린다고 안내', method.includes('사진으로 등록') && method.includes('종이 계약서를 촬영하거나 사진 선택') && method.includes('계약서는 비공개로 보관됩니다.') && method.includes('지원되는 PDF에서는 민감정보를 찾아 가려서 표시합니다.'));
  await page.click(tid('method-photo'));
  await page.waitForSelector(tid('photo-sheet'));
  const sheet = await page.locator(tid('photo-sheet')).innerText();
  check('S', '사진 등록 시트: 지금 촬영하기 / 앨범에서 선택', sheet.includes('계약서 사진 등록') && sheet.includes('지금 촬영하기') && sheet.includes('앨범에서 선택'));
  await shot('01-sheet');

  // 2) 음식 사진
  await openAlbum([['음식.jpg', doc]]);
  await page.waitForSelector(tid('gate-non-contract'), { timeout: 30000 });
  const nc = await body();
  check('C', '음식 사진 → "계약서로 확인하기 어려워요" + 다른 파일 선택 / 직접 입력 (확인 화면으로 가지 않음)', nc.includes('계약서로 확인하기 어려워요') && nc.includes('다른 파일 선택') && nc.includes('직접 입력') && !nc.includes('잘못된 파일'));
  await shot('02-non-contract');
  await page.click(tid('gate-choose-other'));
  await page.waitForSelector(tid('method-pdf'));
  check('C2', '"다른 파일 선택" → 등록 방식 화면', true);

  // 3) 해상도가 너무 낮은 사진 (업로드 전)
  await openAlbum([['계약서.jpg', small]]);
  await page.waitForSelector(tid('gate-unreadable'), { timeout: 20000 });
  const ur = await body();
  check('E', '저해상도 사진 → "계약 내용을 읽기 어려워요" · 다시 촬영 / 다른 사진 선택 (업로드 전)', ur.includes('계약 내용을 읽기 어려워요') && ur.includes('해상도가 너무 낮아요') && ur.includes('다시 촬영') && ur.includes('다른 사진 선택'));
  await page.waitForTimeout(1500);
  check('S2', '사진 선택 후 시트가 닫혀 다음 화면을 가리지 않음', !(await page.locator(tid('photo-sheet')).isVisible().catch(() => false)));
  await shot('03-unreadable');

  // 4) 계약서 4장 + 책상 사진
  await openAlbum([['계약서_1.jpg', docs[0]], ['계약서_2.jpg', docs[1]], ['책상.jpg', desk], ['계약서_3.jpg', docs[2]], ['계약서_4.jpg', docs[3]]]);
  await page.waitForSelector(tid('gate-pages'), { timeout: 40000 });
  const pages = await page.locator(tid('gate-pages')).innerText();
  check('F', '의심 사진 안내: "3번째 사진을 계약 관련 문서로 확인하기 어려워요" + 3페이지 제외 / 그대로 포함', pages.includes('3번째 사진을 계약 관련 문서로 확인하기 어려워요') && pages.includes('3페이지 제외') && pages.includes('그대로 포함'));
  await shot('04-pages');
  await page.click(tid('gate-page-3-exclude'));
  await page.click(tid('gate-pages-continue'));
  await page.waitForSelector(tid('submit-contract'), { timeout: 40000 });
  await page.waitForTimeout(400);
  const review = await body();
  check('F2', '3번째 사진 제외 → 확인 화면에 그 사진의 3,000,000원이 없음, 계약 렌탈료는 있음', !review.includes('3,000,000') && !review.includes('3000000') && review.includes('29,900'));
  await shot('05-review-after-exclude');
  await page.locator(`${tid('register-close')} >> visible=true`).first().click();

  // 4-2) 같은 사진을 두 번 고르면 한 번만 올림 (업로드 전)
  await openAlbum([['계약서_a.jpg', docs[0]], ['계약서_b.jpg', docs[0]]]);
  await page.waitForSelector(tid('analyzing-notice'), { timeout: 20000 });
  check('D', '같은 사진 중복 → "같은 사진 1장은 한 번만 올렸어요"', (await page.locator(tid('analyzing-notice')).innerText()).includes('같은 사진 1장은 한 번만 올렸어요'));
  await page.waitForSelector(tid('submit-contract'), { timeout: 40000 });
  await page.locator(`${tid('register-close')} >> visible=true`).first().click();

  // 5) 직접 촬영 (웹: 카메라 대신 파일 선택)
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  await page.click(tid('method-photo'));
  await page.waitForSelector(tid('photo-sheet'));
  const [first] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.click(tid('photo-camera'))]);
  await first.setFiles({ name: 'cam1.jpg', mimeType: 'image/jpeg', buffer: doc });
  await page.waitForSelector(tid('capture-page-1'), { timeout: 15000 });
  check('K1', '촬영: 1장 촬영됨 + 다음 페이지 촬영 / 촬영 완료', (await page.locator(tid('capture-count')).innerText()).includes('1장 촬영됨') && (await body()).includes('촬영 완료'));
  const [second] = await Promise.all([page.waitForEvent('filechooser'), page.click(tid('capture-next'))]);
  await second.setFiles({ name: 'cam2.jpg', mimeType: 'image/jpeg', buffer: doc });
  await page.waitForSelector(tid('capture-page-2'));
  check('K2', '두 장 → "2장 촬영됨", 페이지 번호·삭제·다시 촬영', (await page.locator(tid('capture-count')).innerText()).includes('2장 촬영됨') && (await body()).includes('다시 촬영'));
  await page.waitForTimeout(1500);
  check('S3', '촬영 화면에 시트가 남지 않음', !(await page.locator(tid('photo-sheet')).isVisible().catch(() => false)));
  await shot('06-capture');
  await page.click(tid('capture-delete-2'));
  await page.waitForTimeout(200);
  check('K3', '잘못 찍은 페이지 삭제 → 1장', (await page.locator(tid('capture-count')).innerText()).includes('1장 촬영됨'));
  await page.click(tid('capture-done'));
  await page.waitForSelector(tid('submit-contract'), { timeout: 40000 });
  check('K4', '촬영 완료 → 같은 등록 흐름(보관 → 문서 확인 → 분석) → 확인 화면', true);
  const prot = await body();
  check('P', '사진 계약서: "보호됐다"고 표시하지 않음 (사진 자동 가리기 미지원 안내)', !prot.includes('민감정보를 보호했어요') && prot.includes('사진으로 등록한 계약서'));
  await shot('07-review-photo');

  console.log('\npage errors:', errors.length ? errors : 'none');
  const failed = results.filter((r) => !r.ok);
  require('fs').writeFileSync(path.join(SHOTS, 'photo-gate-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  if (failed.length) process.exit(1);
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
