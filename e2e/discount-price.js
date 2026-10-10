/**
 * 할인 전 금액 E2E (실제 데이터 모드 · 로컬 Supabase · 서버 mock AI "할인" 시나리오) — 모든 값은 가짜
 * 월 렌탈료 45,900원(할인전) → 확인 화면에서 금액 칸 비움 + "할인 적용 금액 확인 필요" → 입력 없이 저장 불가
 * → 실제 결제액 31,900 입력 → 저장 → DB amount 31,900 · 할인액·등록비·설치비는 결제 아님 · 할인·면제 조건은 계약 체크로
 * 사용: BASE_URL=http://localhost:8082 node e2e/discount-price.js
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
const pdf = () => {
  const f = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pacto-e2e-disc-")),
    "rental.pdf",
  );
  execFileSync(
    "node",
    [
      "--experimental-strip-types",
      "--no-warnings",
      path.join(ROOT, "tests/protection/cli.ts"),
      "make",
      "clean",
      f,
    ],
    { cwd: ROOT },
  );
  return fs.readFileSync(f);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => undefined));
  const body = () => page.locator("body").innerText();
  const shot = (n) =>
    page.screenshot({
      path: path.join(SHOTS, `discount-${n}.png`),
      fullPage: true,
    });
  const email = `discount-${Date.now()}@pacto.test`;
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

  await page.click(tid("first-run-register"));
  await page.waitForSelector(tid("method-pdf"));
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(tid("method-pdf")),
  ]);
  await chooser.setFiles({
    name: "정수기_할인.pdf",
    mimeType: "application/pdf",
    buffer: pdf(),
  });
  await page.waitForSelector(tid("submit-contract"), { timeout: 90000 });
  await page.waitForTimeout(800);

  // ① 확인 화면
  const amount = await page
    .locator(`input${tid("payment-0-amount")}`)
    .first()
    .inputValue();
  const text = await body();
  check(
    "A",
    "할인전 금액 45,900은 금액 칸에 채우지 않음",
    amount === "",
    amount,
  );
  check(
    "A2",
    '"할인 적용 금액 확인 필요" 안내 + 계약서 금액(할인 전) 표시',
    text.includes("할인 적용 금액 확인 필요") &&
      text.includes("45,900원은 할인 전(정상가) 금액"),
  );
  check(
    "C",
    "결제에 넣지 않은 금액: 할인액(할인) · 등록비·설치비(면제)",
    text.includes("E규정 할인 (할인)") &&
      text.includes("등록비 (면제)") &&
      text.includes("설치비 (면제)"),
  );
  check(
    "C2",
    "할인·면제 조건: 전체회차 할인 · 회차 면제 · 면제된 금액 (계약 체크)",
    text.includes("전체회차 할인") &&
      text.includes("회차 면제 프로모션") &&
      text.includes("면제된 금액"),
  );
  check(
    "C3",
    "확인 화면 결제는 월 렌탈료 1건뿐 (할인액·면제 비용 결제 없음)",
    (await page.locator(`input${tid("payment-1-amount")}`).count()) === 0,
  );
  await shot("01-review");

  // ② 입력 없이 저장 → 막힘
  await page.click(tid("submit-contract"));
  await page.waitForTimeout(1200);
  const contracts0 = await admin(
    `/rest/v1/contracts?select=id&user_id=eq.${userId}`,
  );
  check(
    "A3",
    "실제 결제액 없이 저장 불가 (계약 미생성)",
    contracts0.length === 0 && (await body()).includes("금액을 입력해주세요"),
    JSON.stringify(contracts0),
  );

  // ③ 실제 결제액 입력 → 저장
  await page.fill(`input${tid("payment-0-amount")}`, "31900");
  await page.click(tid("submit-contract"));
  await page.waitForSelector(tid("detail-open-document"), { timeout: 15000 });
  await page.waitForTimeout(800);
  const pays = await admin(
    `/rest/v1/contract_payments?select=label,amount,frequency,day_of_month,obligation&user_id=eq.${userId}`,
  );
  check(
    "B",
    "저장: 월 렌탈료 31,900 · 매월 15일 (45,900·14,000·100,000·30,000 결제 없음)",
    JSON.stringify(pays) ===
      JSON.stringify([
        {
          label: "월 렌탈료",
          amount: 31900,
          frequency: "monthly",
          day_of_month: 15,
          obligation: "confirmed",
        },
      ]),
    JSON.stringify(pays),
  );
  const [c] = await admin(
    `/rest/v1/contracts?select=ai_checks&user_id=eq.${userId}`,
  );
  const topics = (c?.ai_checks ?? [])
    .filter((x) => x.topic === "discount_terms")
    .map((x) => x.title);
  check(
    "C4",
    "할인·면제 조건이 계약에 저장됨 (상세에서 확인)",
    ["전체회차 할인", "회차 면제 프로모션", "면제된 금액"].every((t) =>
      topics.includes(t),
    ),
    JSON.stringify(topics),
  );
  const detail = await body();
  check(
    "B2",
    "상세: 31,900원 표시 · 45,900원 결제 표시 없음",
    detail.includes("31,900원") && !detail.includes("45,900원 결제"),
  );
  await shot("02-detail");
  check("Z", "페이지 오류 없음", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
