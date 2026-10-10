/**
 * 암호 PDF E2E (실제 데이터 모드 · 로컬 Supabase · qpdf · 서버 mock AI) — 모든 값은 가짜
 * 업로드 → "비밀번호가 설정된 계약서예요" → 틀린 비밀번호(재입력) → 맞는 비밀번호 → 보호 → 분석(보호본) → 확인 → 저장
 * → 보호본은 비밀번호 없이(암호 없음·원문 없음) / 원본은 확인 후 암호 상태 그대로
 * → 다른 등록: "비밀번호를 모르겠어요" → 안내 → 등록 취소(원본 삭제, 계약 없음)
 * → 비밀번호가 화면 밖(브라우저 저장소·콘솔·DB)에 남지 않음
 * 사용: BASE_URL=http://localhost:8082 node e2e/encrypted-pdf.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:8082";
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.join(__dirname, "..");
const tid = (id) => `[data-testid="${id}"]`;
const check = (no, name, ok, detail = "") => {
  console.log(
    ok ? "✔" : "✘",
    `${no}. ${name}`,
    detail && !ok ? `— ${detail}` : "",
  );
  if (!ok) process.exitCode = 1;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pacto-e2e-enc-"));
const cli = (...a) =>
  execFileSync(
    "node",
    [
      "--experimental-strip-types",
      "--no-warnings",
      path.join(ROOT, "tests/protection/cli.ts"),
      ...a,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
const PW = "E2e!비번 2026";
const encrypted = () => {
  const plain = path.join(tmp, "plain.pdf");
  const out = path.join(tmp, `enc-${Date.now()}.pdf`);
  cli("make", "employment", plain);
  cli("encrypt", plain, "aes256", PW, out);
  return fs.readFileSync(out);
};
const pdfText = (buf) => {
  const f = path.join(tmp, `${Date.now()}-${Math.random()}.pdf`);
  fs.writeFileSync(f, buf);
  return cli("text", f).replace(/\s+/g, "");
};
const env = JSON.parse(
  execSync("npx supabase status -o json", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).replace(/^[^{]*/, ""),
);
const admin = async (p) =>
  (
    await fetch(`${env.API_URL}${p}`, {
      headers: {
        apikey: env.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
      },
    })
  ).json();
const SECRETS = [
  "901225-1234567",
  "1234567",
  "010-1234-5678",
  "minjun@example.com",
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  const dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => logs.push(m.text()));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => undefined);
  });
  const body = () => page.locator("body").innerText();
  const shot = (n) =>
    page.screenshot({ path: path.join(SHOTS, `encrypted-${n}.png`) });
  const email = `enc-${Date.now()}@pacto.test`;
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.click(tid("signin-email"));
  await page.click(tid("go-sign-up"));
  await page.fill(`input${tid("sign-up-email")}`, email);
  await page.fill(`input${tid("sign-up-password")}`, "pacto-ui-password-1");
  await page.fill(`input${tid("sign-up-confirm")}`, "pacto-ui-password-1");
  await page.click(tid("consent-terms"));
  await page.click(tid("consent-privacy"));
  await page.click(tid("sign-up-submit"));
  await page.waitForSelector(tid("home-first-run"), { timeout: 15000 });
  const userId = (await admin("/auth/v1/admin/users?per_page=200")).users.find(
    (u) => u.email === email,
  ).id;

  // ① 업로드 → 비밀번호 화면
  await page.click(tid("first-run-register"));
  await page.waitForSelector(tid("method-pdf"));
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(tid("method-pdf")),
  ]);
  await chooser.setFiles({
    name: "근로계약서_암호.pdf",
    mimeType: "application/pdf",
    buffer: encrypted(),
  });
  await page.waitForSelector(tid("gate-password"), { timeout: 40000 });
  const gate = await body();
  const inputType = await page
    .locator(`input${tid("pdf-password-input")}`)
    .getAttribute("type");
  check(
    "U",
    '비밀번호 화면: 제목·설명("저장하지 않습니다")·비밀번호 입력(가림)·계약서 열기',
    gate.includes("비밀번호가 설정된 계약서예요") &&
      gate.includes("계약서를 확인하려면 PDF 비밀번호를 입력해주세요.") &&
      gate.includes("입력한 비밀번호는 저장하지 않습니다.") &&
      inputType === "password" &&
      gate.includes("계약서 열기"),
    `${inputType}`,
  );
  await shot("01-password");

  // ② 틀린 비밀번호 → 다시 입력
  for (const wrong of ["wrong-1", "wrong-2"]) {
    await page.fill(`input${tid("pdf-password-input")}`, wrong);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/functions/v1/protect-document"),
        { timeout: 30000 },
      ),
      page.click(tid("pdf-password-submit")),
    ]);
    await page.waitForFunction(
      () => document.body.innerText.includes("비밀번호가 맞지 않아요."),
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(300);
  }
  check(
    "C",
    '틀린 비밀번호 → "비밀번호가 맞지 않아요. 다시 확인해주세요." · 다시 입력 가능 (분석 시작 안 함)',
    (await body()).includes("다시 확인해주세요.") &&
      (await page.locator(tid("gate-password")).count()) === 1,
  );
  const jobsBefore = await admin(
    `/rest/v1/analysis_jobs?select=id&user_id=eq.${userId}`,
  );
  check(
    "C2",
    "틀린 비밀번호 동안 분석 작업 없음",
    Array.isArray(jobsBefore) && jobsBefore.length === 0,
    JSON.stringify(jobsBefore),
  );
  await shot("02-invalid");

  // ③ 맞는 비밀번호 → 보호 → 분석 → 확인 화면
  await page.fill(`input${tid("pdf-password-input")}`, PW);
  await page.click(tid("pdf-password-submit"));
  await page
    .waitForSelector(tid("review-protection-0"), { timeout: 60000 })
    .catch(async (e) => {
      await shot("03-stuck");
      console.log((await body()).slice(0, 400), logs.slice(-10).join("\n"));
      throw e;
    });
  await page.waitForTimeout(500);
  const card = await page.locator(tid("review-protection-0")).innerText();
  check(
    "B",
    "맞는 비밀번호 → 민감정보를 보호했어요 → 확인 화면",
    card.includes("민감정보를 보호했어요"),
    card.split("\n")[0],
  );
  const amt = await page
    .locator(`input${tid("payment-0-amount")}`)
    .first()
    .inputValue()
    .catch(() => "");
  check(
    "B2",
    "분석 결과가 확인 화면에 (급여 3,600,000)",
    amt === "3,600,000",
    amt,
  );
  await shot("03-review");

  // ④ 저장 → 상세 → 보호본(비밀번호 없이) / 원본(확인 후, 암호 그대로)
  await page.click(tid("submit-contract"));
  await page.waitForSelector(tid("detail-open-document"), { timeout: 15000 });
  const grab = async (click) => {
    const [req] = await Promise.all([
      context.waitForEvent("request", {
        predicate: (r) =>
          r.method() === "GET" &&
          r.url().includes("/storage/v1/object/sign/contract-files/"),
        timeout: 15000,
      }),
      click(),
    ]);
    const buf = Buffer.from(
      await (await context.request.get(req.url())).body(),
    );
    for (const p of context.pages()) if (p !== page) await p.close();
    return { url: req.url(), buf };
  };
  const view = await grab(() => page.click(tid("detail-open-document")));
  const viewText = pdfText(view.buf);
  check(
    "E",
    "보호본: 비밀번호 없이 열림(암호 없음) · 주민번호·전화·이메일 없음",
    view.url.includes(".protected_view.pdf") &&
      !view.buf.includes("/Encrypt") &&
      SECRETS.every((s) => !viewText.includes(s)) &&
      viewText.includes("3,600,000원"),
  );
  const docId = (
    await page
      .locator('[data-testid^="protection-"][data-testid$="-original"]')
      .first()
      .getAttribute("data-testid")
  )
    .replace(/^protection-/, "")
    .replace(/-original$/, "");
  const n0 = dialogs.length;
  const orig = await grab(() =>
    page.click(tid(`protection-${docId}-original`)),
  );
  check(
    "F",
    "원본 보기: 확인 문구 후 원본(암호 그대로 — 열 때 비밀번호를 다시 입력)",
    dialogs.slice(n0).some((m) => m.includes("원본 계약서를 표시합니다")) &&
      orig.buf.includes("/Encrypt") &&
      !orig.url.includes("protected_view"),
  );
  await shot("04-detail");

  // ⑤ 다른 등록: 비밀번호를 모르겠어요 → 안내 → 등록 취소 (원본 삭제)
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector(tid("tab-add"));
  await page.click(tid("tab-add"));
  await page.waitForSelector(tid("method-pdf"));
  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(tid("method-pdf")),
  ]);
  await chooser2.setFiles({
    name: "모르는비번.pdf",
    mimeType: "application/pdf",
    buffer: encrypted(),
  });
  await page.waitForSelector(tid("gate-password"), { timeout: 40000 });
  await page.click(tid("pdf-password-unknown"));
  await page.waitForSelector(tid("gate-locked-unknown"));
  const locked = await body();
  check(
    "D1",
    '"비밀번호를 모르겠어요" → "이 PDF의 비밀번호를 확인할 수 없어요" 안내',
    locked.includes("이 PDF의 비밀번호를 확인할 수 없어요.") &&
      locked.includes("잠금이 해제된 파일을 다시 등록해주세요."),
  );
  await shot("05-unknown");
  await page.click(tid("gate-locked-secondary"));
  await page.waitForTimeout(1500);
  const docs = await admin(
    `/rest/v1/contract_documents?select=id,contract_id&user_id=eq.${userId}`,
  );
  const contracts = await admin(
    `/rest/v1/contracts?select=id&user_id=eq.${userId}`,
  );
  check(
    "D",
    "등록 취소 → 계약 미등록 · 연결 안 된 원본 삭제 (계약 1건·문서 1건만 남음)",
    contracts.length === 1 &&
      docs.length === 1 &&
      docs[0].contract_id === contracts[0].id,
    `${contracts.length}/${docs.length}`,
  );

  // ⑥ 비밀번호가 브라우저 저장소·콘솔·DB에 없음
  const stores = await page.evaluate(() =>
    JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
  );
  const db = JSON.stringify([
    await admin(`/rest/v1/contract_documents?select=*&user_id=eq.${userId}`),
    await admin(`/rest/v1/analysis_jobs?select=*&user_id=eq.${userId}`),
    await admin(`/rest/v1/contracts?select=*&user_id=eq.${userId}`),
  ]);
  check(
    "K",
    "비밀번호가 브라우저 저장소·콘솔·DB에 없음",
    ![stores, logs.join("\n"), db].some(
      (t) => t.includes(PW) || t.includes("wrong-1"),
    ),
  );
  check("Z", "페이지 오류 없음", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
