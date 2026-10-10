/**
 * MY 프로필 E2E (실제 데이터 모드 · 로컬 Supabase) — 모든 값은 가짜
 * 진단 메뉴 없음 → 프로필 영역 → 프로필 편집 → 사진 선택(가로로 긴 큰 사진 → 512x512) + 닉네임 → 저장
 * → MY: 사진·닉네임(메인)·이메일 → 새로고침(앱 재실행) 후 유지 → 사진 변경 → 업로드 실패 시 기존 사진 유지·닉네임 저장
 * → 로그아웃·재로그인 후 유지 → 사진 삭제 → 기본 아바타 · 닉네임 지우면 이메일이 메인
 * 사용: BASE_URL=http://localhost:8082 node e2e/profile.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { execSync } = require("child_process");
const fs = require("fs");
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
const listAvatars = async (userId) =>
  (
    await (
      await fetch(`${env.API_URL}/storage/v1/object/list/profile-images`, {
        method: "POST",
        headers: {
          apikey: env.SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix: userId, limit: 10 }),
      })
    ).json()
  ).map((o) => ({ name: o.name, size: o.metadata?.size }));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => undefined);
  });
  const shot = (n) =>
    page.screenshot({ path: path.join(SHOTS, `profile-${n}.png`) });
  const text = (id) => page.locator(tid(id)).innerText();
  /** 가짜 사진 (캔버스) — 색으로 구분 */
  const photo = async (w, h, color) =>
    Buffer.from(
      await page.evaluate(
        ([w, h, color]) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d");
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          return c.toDataURL("image/jpeg", 0.9).split(",")[1];
        },
        [w, h, color],
      ),
      "base64",
    );
  const avatarImage = async () => {
    const img = page.locator(`${tid("my-avatar")} img`).first();
    if ((await img.count()) === 0) return null;
    await page
      .waitForFunction(
        (sel) => document.querySelector(sel)?.complete,
        `${tid("my-avatar")} img`,
        { timeout: 10000 },
      )
      .catch(() => undefined);
    const src = await img.getAttribute("src");
    return page.evaluate(async (src) => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      const [r, g, b] = c
        .getContext("2d")
        .getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return { w: bmp.width, h: bmp.height, r, g, b };
    }, src);
  };
  const choosePhoto = async (buffer) => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click(tid("profile-avatar-choose")),
    ]);
    await chooser.setFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer });
    await page.waitForSelector(`${tid("profile-avatar-view")} img`, {
      timeout: 10000,
    });
  };
  const openEdit = async () => {
    await page.click(tid("my-profile"));
    await page.waitForSelector(tid("profile-save"));
    await page.waitForTimeout(500);
  };
  const save = async () => {
    await page.click(tid("profile-save"));
    await page.waitForSelector(tid("my-profile"), { timeout: 15000 });
    await page.waitForTimeout(800);
  };
  const toMy = async () => {
    await page.waitForSelector(tid("tab-my"), { timeout: 15000 });
    await page.click(tid("tab-my"));
    await page.waitForSelector(tid("my-profile"));
    await page.waitForTimeout(800);
  };

  const email = `profile-${Date.now()}@pacto.test`;
  const password = "pacto-ui-password-1";
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.click(tid("signin-email"));
  await page.click(tid("go-sign-up"));
  await page.fill(`input${tid("sign-up-email")}`, email);
  await page.fill(`input${tid("sign-up-password")}`, password);
  await page.fill(`input${tid("sign-up-confirm")}`, password);
  await page.click(tid("consent-terms"));
  await page.click(tid("consent-privacy"));
  await page.click(tid("sign-up-submit"));
  await page.waitForSelector(tid("home-first-run"), { timeout: 15000 });
  const userId = (await admin("/auth/v1/admin/users?per_page=200")).users.find(
    (u) => u.email === email,
  ).id;
  await toMy();

  // ① 처음: 이메일이 메인 · 진단 메뉴 없음
  const body0 = await page.locator("body").innerText();
  check(
    "A",
    'MY: 닉네임 없으면 이메일 + "이메일 계정" · 기본 아바타',
    (await text("my-profile-name")) === email &&
      (await text("my-profile-sub")).startsWith("이메일 계정") &&
      (await avatarImage()) === null,
  );
  check(
    "A2",
    '"계약서 뷰어 진단" 메뉴 없음',
    !body0.includes("뷰어 진단") &&
      !body0.includes("단계별로 열어") &&
      (await page.locator(tid("open-viewer-diagnostics")).count()) === 0,
  );
  await shot("01-my-default");

  // ② 프로필 편집: 사진(가로로 긴 1600x900) + 닉네임 → 저장
  await openEdit();
  check(
    "B0",
    "프로필 편집: 이메일 읽기 전용 표시",
    (await text("profile-email")) === email &&
      (await page.locator(`input${tid("profile-email")}`).count()) === 0,
  );
  await page.fill(`input${tid("profile-nickname")}`, " 가");
  await page.click(tid("profile-save"));
  await page.waitForTimeout(300);
  check(
    "B1",
    "닉네임 규칙: 1자 → 저장 안 됨 + 안내",
    (await page.locator("body").innerText()).includes(
      "닉네임은 2~20자로 입력해주세요.",
    ),
  );
  await choosePhoto(await photo(1600, 900, "#d23c3c"));
  await page.fill(`input${tid("profile-nickname")}`, "  가짜 닉네임  ");
  await shot("02-edit");
  await save();
  const img1 = await avatarImage();
  check(
    "B",
    "저장 → MY: 닉네임 메인 · 이메일 아래 · 사진 표시",
    (await text("my-profile-name")) === "가짜 닉네임" &&
      (await text("my-profile-sub")) === email &&
      !!img1,
  );
  check(
    "B2",
    "사진은 정사각형 512x512로 줄여 저장 (원본 1600x900)",
    img1?.w === 512 && img1?.h === 512,
    JSON.stringify(img1),
  );
  const objs = await listAvatars(userId);
  check(
    "B3",
    "Storage: profile-images/{user_id}/avatar.jpg 하나 · 크기 작음(< 200KB)",
    objs.length === 1 &&
      objs[0].name === "avatar.jpg" &&
      objs[0].size < 200_000,
    JSON.stringify(objs),
  );
  check(
    "B4",
    "DB: display_name·avatar_path 저장",
    JSON.stringify(
      await admin(
        `/rest/v1/profiles?select=display_name,avatar_path&id=eq.${userId}`,
      ),
    ) ===
      JSON.stringify([
        { display_name: "가짜 닉네임", avatar_path: `${userId}/avatar.jpg` },
      ]),
  );
  await shot("03-my-profile");

  // ③ 새로고침(앱 재실행) 후 유지
  await page.reload({ waitUntil: "networkidle" });
  await toMy();
  const img2 = await avatarImage();
  check(
    "C",
    "앱 재실행 후 사진·닉네임 유지",
    (await text("my-profile-name")) === "가짜 닉네임" &&
      img2?.r > 150 &&
      img2?.g < 100,
  );

  // ④ 사진 변경 (파란색)
  await openEdit();
  await choosePhoto(await photo(900, 900, "#2a5bd7"));
  await save();
  const img3 = await avatarImage();
  check(
    "D",
    "사진 변경 → 새 사진 표시",
    img3?.b > 150 && img3?.r < 100,
    JSON.stringify(img3),
  );

  // ⑤ 업로드 실패 → 기존 사진 유지 · 닉네임은 저장
  await page.route("**/storage/v1/object/profile-images/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 500, body: '{"error":"fail"}' }),
  );
  await openEdit();
  await choosePhoto(await photo(800, 800, "#2fa84f"));
  await page.fill(`input${tid("profile-nickname")}`, "실패해도 저장");
  const n0 = dialogs.length;
  await page.click(tid("profile-save"));
  await page.waitForTimeout(2500);
  check(
    "E1",
    '업로드 실패 안내 ("기존 사진을 유지")',
    dialogs.slice(n0).some((m) => m.includes("기존 사진을 유지")),
  );
  await page.unroute("**/storage/v1/object/profile-images/**");
  await page.goBack();
  await toMy();
  const img4 = await avatarImage();
  check(
    "E",
    "업로드 실패 → 기존(파란) 사진 유지 · 닉네임은 저장",
    (await text("my-profile-name")) === "실패해도 저장" &&
      img4?.b > 150 &&
      img4?.g < 150,
    JSON.stringify(img4),
  );

  // ⑥ 로그아웃 → 재로그인 후 유지
  await page.click(tid("sign-out"));
  await page.waitForSelector(tid("signin-email"), { timeout: 15000 });
  await page.click(tid("signin-email"));
  await page.fill(`input${tid("sign-in-email")}`, email);
  await page.fill(`input${tid("sign-in-password")}`, password);
  await page.click(tid("sign-in-submit"));
  await toMy();
  const img5 = await avatarImage();
  check(
    "F",
    "로그아웃·재로그인 후 사진·닉네임 유지",
    (await text("my-profile-name")) === "실패해도 저장" && img5?.b > 150,
  );

  // ⑦ 사진 삭제 + 닉네임 지우기 → 기본 아바타 · 이메일 메인
  await openEdit();
  await page.click(tid("profile-avatar-remove"));
  await page.fill(`input${tid("profile-nickname")}`, "");
  await save();
  check(
    "G",
    "사진 삭제 → 기본 아바타 · 닉네임 없으면 이메일 메인",
    (await avatarImage()) === null &&
      (await text("my-profile-name")) === email &&
      (await text("my-profile-sub")).startsWith("이메일 계정"),
  );
  check(
    "G2",
    "삭제 시 Storage 파일도 삭제",
    (await listAvatars(userId)).length === 0,
  );
  await shot("04-my-removed");

  check("Z", "페이지 오류 없음", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
