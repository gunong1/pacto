/**
 * 실제 푸시 알림 — 화면 (실제 데이터 모드, 서버 planner가 만든 예정 알림)
 * 1) 월세 850,000 + 관리비 100,000만 있는 계약 → 알림 화면 중요 일정 없음 ("지금 확인할 중요한 계약 일정이 없어요."), "다음 알림" 목록 없음
 * 2) 계약 상세 "계약 알림" → 이 계약만 직접 설정 / 종료가 가까운 계약 → 중요한 계약 일정에 표시 (실제 계약 날짜, 발송 시각 없음)
 * 3) MY > 알림 설정: 웹 기기 상태 안내 · critical(해지 통보기한) 끄기 확인 · 알림 받는 시간 · 미리보기 · 기본값 되돌리기 · 테스트 알림
 * 4) 알림 화면: 중요한 계약 일정이 없으면 섹션 숨김, 규칙은 접힘(내 설정 요약)
 * 사용: BASE_URL=http://localhost:8082 node e2e/push-settings.js
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
  console.log(`${ok ? '✔' : '✘'} ${id}. ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

// 한국 날짜 기준 오늘+n일
const kst = (n) => {
  const d = new Date(Date.now() + 9 * 3600_000 + n * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const yymmdd = (x) => `${String(x.y).slice(2)}${String(x.m).padStart(2, '0')}${String(x.d).padStart(2, '0')}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 1500 }, locale: 'ko-KR' });
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let dialogAnswer = true;
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    (dialogAnswer ? d.accept() : d.dismiss()).catch(() => undefined);
  });
  const input = (id) => page.locator(`input${tid(id)}, textarea${tid(id)}`);
  const body = () => page.locator('body').innerText();
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `push-${n}.png`), fullPage: true });
  const pay = kst(3);
  const fire = kst(2);

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click(tid('signin-email'));
    await page.click(tid('go-sign-up'));
    await input('sign-up-email').fill(`push-${Date.now()}@pacto.test`);
    await input('sign-up-password').fill('pacto-ui-password-1');
    await input('sign-up-confirm').fill('pacto-ui-password-1');
    await page.click(tid('consent-terms'));
    await page.click(tid('consent-privacy'));
    await page.click(tid('sign-up-submit'));
    await page.waitForSelector(tid('home-first-run'), { timeout: 15000 });

    // 계약 없음 → 빈 상태
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('reminder-policy'));
    const empty = await body();
    check('Z', '계약이 없으면 "아직 예정된 알림이 없어요." + 등록 안내', empty.includes('아직 예정된 알림이 없어요.') && empty.includes('계약을 등록하면 결제일, 만료, 갱신, 해지기한 등 중요한 순간을 챙겨드려요.'));

    // 1) 월세 + 관리비 (지급일 = 오늘+3)
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    await page.click(tid('method-manual'));
    await page.click(tid('toggle-more')); // 직접 입력: 접힌 상세 정보 펼치기
    await page.click(tid('type-lease'));
    await input('field-title').fill('주택 임대차계약');
    await page.click(tid('category-real_estate'));
    await input('field-startDate').fill(yymmdd(pay));
    await input('field-endDate').fill(yymmdd(kst(700)));
    await page.click(tid('detail-leaseKind-monthly'));
    for (const [i, kind, label, amount] of [[0, 'rent', '월세', '850000'], [1, 'maintenance_fee', '관리비', '100000']]) {
      await page.click(tid('add-payment'));
      await page.click(tid(`payment-${i}-kind-${kind}`));
      await page.click(tid(`payment-${i}-frequency-monthly`));
      await input(`payment-${i}-label`).fill(label);
      await input(`payment-${i}-amount`).fill(amount);
      await input(`payment-${i}-dayOfMonth`).fill(String(pay.d));
    }
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    await page.waitForTimeout(800);
    check('P', '웹(푸시 불가 기기)에서는 저장 직후 알림 권한 안내를 띄우지 않음', !(await page.locator(tid('push-prompt')).isVisible().catch(() => false)));
    const mode = await page.locator(tid('contract-notification-mode')).innerText();
    check('D0', '계약 상세 "계약 알림": 현재 내 기본 알림 설정 사용', mode.includes('내 기본 알림 설정 사용'));
    await shot('01-detail');

    const contractId = /\/contract\/([0-9a-f-]{36})/.exec(page.url())[1];
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('important-list'), { timeout: 20000 });
    const all = await body();
    check('E', '일반 결제만 있으면 "지금 확인할 중요한 계약 일정이 없어요." (예정된 알림이 없다고 하지 않음)', all.includes('지금 확인할 중요한 계약 일정이 없어요.') && all.includes('결제와 일반 일정은 캘린더에서 확인할 수 있어요.') && !all.includes('예정된 알림이 없어요'));
    check('A', '"다음 알림"(미래 푸시 목록) 없음 · 결제 알림 문구·발송 시각 없음 · 내부 범위(60일) 문구 없음', !all.includes('다음 알림') && !all.includes('950,000원') && !all.includes('결제 예정') && !all.includes('60일') && (await page.locator(tid('upcoming-list')).count()) === 0);
    check('R', '알림 설정 요약 한 줄(종류별 시점 나열 없음) + 캘린더 안내', all.includes('알림 설정') && all.includes('주요 계약 알림 사용 중') && !all.includes('30·7·1일 전과 당일') && all.includes('결제와 전체 일정은 캘린더에서 확인할 수 있어요.') && all.includes('캘린더 보기'));
    await shot('02-notifications');

    // 2) 이 계약만 직접 설정: 결제 당일
    await page.goto(`${BASE}/contract/${contractId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('open-contract-notifications'));
    await page.click(tid('open-contract-notifications'));
    await page.waitForSelector(tid('contract-notif-custom'));
    await page.click(tid('contract-notif-custom'));
    await page.click(tid('contract-notif-payment-1'));
    await page.click(tid('contract-notif-payment-0'));
    check('D1', '계약별 설정 선택지에 180일 전 포함', (await page.locator(tid('contract-notif-contract_end-180')).count()) === 1);
    await shot('03-contract-override');
    await page.click(tid('contract-notif-save'));
    await page.waitForTimeout(1500);
    await page.goBack();
    await page.waitForSelector(tid('contract-notification-mode'));
    check('D2', '저장 후 "이 계약만 직접 설정"', (await page.locator(tid('contract-notification-mode')).innerText()).includes('이 계약만 직접 설정'));
    // H. 푸시를 눌렀을 때 열리는 경로 (/contract/{id}?from=push&event=…) → 계약 상세 + 어떤 알림인지
    await page.goto(`${BASE}/contract/${contractId}?from=push&event=payment`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('push-opened'), { timeout: 15000 });
    check('H', '푸시 클릭 경로 → 해당 계약 상세 + "알림에서 열었어요 · 결제"', (await page.locator(tid('push-opened')).innerText()).includes('알림에서 열었어요 · 결제') && (await body()).includes('주택 임대차계약'));

    // B. 종료가 가까운 계약 → 중요한 계약 일정 (실제 계약 날짜·D-day, 발송 시각 없음)
    const end = kst(34);
    await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
    await page.click(tid('method-manual'));
    await page.click(tid('toggle-more')); // 직접 입력: 접힌 상세 정보 펼치기
    await page.click(tid('type-lease'));
    await input('field-title').fill('단기 임대차');
    await page.click(tid('category-real_estate'));
    await input('field-startDate').fill(yymmdd(kst(-300)));
    await input('field-endDate').fill(yymmdd(end));
    await page.click(tid('detail-leaseKind-monthly'));
    await page.click(tid('submit-contract'));
    await page.waitForSelector(tid('detail-core'), { timeout: 15000 });
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('important-list'));
    // 실행 화면이 사라지고 목록이 그려질 때까지 (한 번 제목만 읽힌 적이 있어 기다림)
    await page.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes('다가와요'), tid('important-list'), { timeout: 10000 }).catch(() => undefined);
    const imp = await page.locator(tid('important-list')).innerText();
    check('B', `중요한 계약 일정: 단기 임대차 · ${end.y}. ${end.m}. ${end.d}. · D-34 · 계약 확인 (발송 시각 없음)`, imp.includes('단기 임대차') && imp.includes('다가와요') && imp.includes(`${end.y}. ${end.m}. ${end.d}.`) && imp.includes('D-34') && imp.includes('계약 확인') && !imp.includes('오전 9:00') && !imp.includes('주택 임대차계약'), imp);
    await shot('02b-important');

    // 3) MY > 알림 설정
    await page.goto(BASE + '/my', { waitUntil: 'networkidle' });
    await page.click(tid('open-notification-settings'));
    await page.waitForSelector(tid('notif-enabled'));
    const st = await body();
    check('I', '웹: 이 기기에서는 푸시를 받을 수 없다는 안내 (앱은 정상 동작)', st.includes('이 기기에서는 푸시 알림을 받을 수 없어요') && st.includes('웹에서는 푸시 알림을 받을 수 없어요'));
    check('S0', '기본값: 결제 1일 전 · 통보기한 30·7·1·당일 · 만료 90·30·7 · 자동갱신 30·7 / 기본값 사용 중', st.includes('PACTO 기본 알림 설정을 쓰고 있어요') && st.includes('해지·갱신 통보기한') && st.includes('알림 받는 시간') && st.includes('한국 시간 기준'));
    await shot('04-settings');

    dialogs.length = 0;
    dialogAnswer = false; // 유지하기
    await page.click(tid('notif-termination_notice-switch'));
    await page.waitForTimeout(600);
    const kept = (await page.locator(tid('notif-termination_notice-30')).count()) === 1;
    check('K1', '해지 통보기한 알림을 끄려 하면 확인 → "유지하기"면 그대로', dialogs.some((m) => m.includes('해지·갱신 통보기한 알림을 끌까요?') && m.includes('계약상 중요한 기한을 놓칠 수 있어요')) && kept);
    dialogAnswer = true; // 끄기
    await page.click(tid('notif-termination_notice-switch'));
    await page.waitForTimeout(1200);
    check('K2', '확인 후 끄기 → 꺼짐 (강제로 다시 켜지 않음)', (await page.locator(tid('notif-termination_notice-30')).count()) === 0);
    dialogs.length = 0;
    await page.click(tid('notif-payment-switch'));
    await page.waitForTimeout(800);
    check('K3', '결제 알림은 확인 없이 끔', dialogs.length === 0 && (await page.locator(tid('notif-payment-1')).count()) === 0);
    await page.click(tid('notif-payment-switch'));
    await page.waitForTimeout(800);
    await page.click(tid('notif-time-08:00'));
    await page.waitForTimeout(800);
    await page.click(tid('notif-show-details'));
    await page.waitForTimeout(800);
    const st2 = await body();
    check('S1', '알림 시간 오전 8:00 선택 · 미리보기 켜면 잠금화면 노출 안내', st2.includes('계약명과 금액이 알림에 보여요'));
    await page.click(tid('notif-show-details'));
    await page.waitForTimeout(800);
    await shot('05-settings-changed');

    // 테스트 알림 (개발 환경): 등록된 기기가 없으면 안내
    if (await page.locator(tid('notif-test-now')).count()) {
      dialogs.length = 0;
      await page.click(tid('notif-test-now'));
      await page.waitForTimeout(2500);
      check('T', '테스트 알림: 기기가 없으면 "먼저 알림 받기" 안내', dialogs.some((m) => m.includes('알림을 받을 기기가 없어요')), dialogs.join(' | '));
    }

    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('reminder-policy'));
    const pol = await page.locator(tid('reminder-policy')).innerText();
    check('C', '알림 설정 요약 = 내 설정 (해지·종료 꺼짐, 오전 8:00에 알려드려요)', pol.includes('꺼짐') && pol.includes('오전 8:00'), pol);

    // F. PACTO 알림을 모두 끄면: 알림 꺼짐 안내 + 설정 버튼, 중요한 일정은 계속 보임
    await page.goto(BASE + '/settings/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('notif-enabled'));
    await page.click(tid('notif-enabled'));
    await page.waitForTimeout(1200);
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('push-off'), { timeout: 10000 });
    const off = await body();
    check('F', '알림 OFF → "알림이 꺼져 있어요" + 알림 설정 버튼, 중요한 계약 일정은 계속 표시', off.includes('알림이 꺼져 있어요') && (await page.locator(tid('push-off-settings')).count()) === 1 && off.includes('단기 임대차'));
    await shot('06-notifications-after');

    // 기본값으로 되돌리기
    await page.goto(BASE + '/settings/notifications', { waitUntil: 'networkidle' });
    await page.waitForSelector(tid('notif-reset'));
    await page.click(tid('notif-reset'));
    await page.waitForSelector(tid('notif-is-default'), { timeout: 10000 });
    check('S2', 'PACTO 기본값으로 되돌리기', (await page.locator(tid('notif-termination_notice-30')).count()) === 1 && (await page.locator(tid('notif-time-09:00')).getAttribute('aria-selected')) !== 'false');
  } catch (e) {
    check('X', '예외 없음', false, e.message);
  }

  console.log('\npage errors:', errors.length ? errors : 'none');
  require('fs').writeFileSync(path.join(SHOTS, 'push-settings-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  if (results.some((r) => !r.ok)) process.exit(1);
})();
