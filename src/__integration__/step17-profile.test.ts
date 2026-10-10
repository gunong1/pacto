/*
 * 프로필 (로컬 Supabase · RLS · Storage 정책) — 모든 값은 가짜
 * 닉네임 등록·수정·규칙 / 사진 등록·변경·삭제 / 다시 로그인(앱 재실행·다른 기기) 후 유지 / 사진 업로드 실패 시 기존 사진 유지
 * / 다른 사용자 사진 접근·수정 차단 / 회원 탈퇴 시 사진 삭제
 */
import {
  AVATAR_BUCKET,
  normalizeNickname,
  SupabaseProfileStore,
} from "@/data/profile";
import { SupabaseAuthService } from "@/features/auth/authService";

import {
  adminClient,
  anonClient,
  localEnv,
  newUser,
  testFetch,
} from "./helpers";

jest.setTimeout(120_000);

/** 가짜 JPEG 바이트 (헤더 + 표시 바이트) — 내용 비교용 */
const jpeg = (mark: number, size = 2048) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.fill(mark, 4);
  return b.buffer;
};
const download = async (url: string) =>
  new Uint8Array(await (await testFetch(url)).arrayBuffer());
const objects = async (userId: string) =>
  (
    (await adminClient().storage.from(AVATAR_BUCKET).list(userId)).data ?? []
  ).map((o) => o.name);
const signIn = async (email: string, password: string) => {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
};

describe("닉네임", () => {
  it("규칙: 앞뒤 공백 제거 · 2~20자 · 빈 값은 없음 · 특수문자 허용", () => {
    expect(normalizeNickname("  송치호  ")).toEqual({ value: "송치호" });
    expect(normalizeNickname("   ")).toEqual({ value: null });
    expect(normalizeNickname("a")).toHaveProperty("error");
    expect(normalizeNickname("가".repeat(21))).toHaveProperty("error");
    expect(normalizeNickname("가".repeat(20))).toEqual({
      value: "가".repeat(20),
    });
    expect(normalizeNickname("팩토_user!·★")).toEqual({
      value: "팩토_user!·★",
    });
    expect(normalizeNickname("줄\n바꿈")).toHaveProperty("error");
  });

  it("등록 → 수정 → 다시 로그인해도 유지 · DB가 규칙 밖 값을 거부", async () => {
    const a = await newUser("nick");
    const store = new SupabaseProfileStore(a.client);
    expect((await store.get()).displayName).toBeNull();
    await store.save({ displayName: "가짜닉네임" });
    await store.save({ displayName: "바뀐 닉네임" });
    const again = new SupabaseProfileStore(await signIn(a.email, a.password));
    expect((await again.get()).displayName).toBe("바뀐 닉네임");
    // 앱 검사를 거치지 않은 값도 DB에서 막힌다
    for (const bad of ["a", " 앞공백", "가".repeat(21), ""]) {
      const { error } = await a.client
        .from("profiles")
        .update({ display_name: bad })
        .eq("id", a.user.id);
      expect(error).not.toBeNull();
    }
    await store.save({ displayName: null });
    expect((await store.get()).displayName).toBeNull();
  });
});

describe("프로필 사진", () => {
  it("등록 → 변경 → 다시 로그인(다른 기기)해도 표시 → 삭제하면 기본 아바타 · 파일도 삭제", async () => {
    const a = await newUser("avatar");
    const store = new SupabaseProfileStore(a.client);
    const first = await store.save({ avatar: jpeg(1) });
    expect(first.avatarFailed).toBe(false);
    expect(first.profile.avatarUrl).toMatch(
      /\/storage\/v1\/object\/sign\/profile-images\//,
    );
    expect((await download(first.profile.avatarUrl!))[10]).toBe(1);
    const row = (
      await adminClient()
        .from("profiles")
        .select("avatar_path")
        .eq("id", a.user.id)
        .single()
    ).data!;
    expect(row.avatar_path).toBe(`${a.user.id}/avatar.jpg`);

    const changed = await store.save({ avatar: jpeg(2) });
    expect((await download(changed.profile.avatarUrl!))[10]).toBe(2);
    expect(await objects(a.user.id)).toEqual(["avatar.jpg"]);

    // 다른 기기(새 로그인)에서도 같은 사진
    const other = new SupabaseProfileStore(await signIn(a.email, a.password));
    expect((await download((await other.get()).avatarUrl!))[10]).toBe(2);

    const removed = await store.save({ avatar: "remove" });
    expect(removed.profile.avatarUrl).toBeNull();
    expect(await objects(a.user.id)).toEqual([]);
    expect((await other.get()).avatarUrl).toBeNull();
  });

  it("사진 업로드 실패 → 기존 사진 유지 · 닉네임은 저장", async () => {
    const a = await newUser("avatar-fail");
    const store = new SupabaseProfileStore(a.client);
    await store.save({ avatar: jpeg(7) });
    // 버킷 한도(1MB)를 넘는 파일 → 저장소가 거부
    const r = await store.save({
      displayName: "실패테스트",
      avatar: jpeg(9, 1_200_000),
    });
    expect(r.avatarFailed).toBe(true);
    expect(r.profile.displayName).toBe("실패테스트");
    expect((await download(r.profile.avatarUrl!))[10]).toBe(7);
  });

  it("공개 주소로는 열리지 않음 (비공개 버킷)", async () => {
    const a = await newUser("avatar-public");
    await new SupabaseProfileStore(a.client).save({ avatar: jpeg(3) });
    const res = await testFetch(
      `${localEnv().API_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${a.user.id}/avatar.jpg`,
    );
    expect(res.ok).toBe(false);
  });

  it("다른 사용자: 사진 보기·올리기·덮어쓰기·지우기·경로 지정·프로필 수정 모두 차단", async () => {
    const a = await newUser("owner");
    const b = await newUser("intruder");
    await new SupabaseProfileStore(a.client).save({
      avatar: jpeg(5),
      displayName: "주인",
    });
    const target = `${a.user.id}/avatar.jpg`;
    const bucket = b.client.storage.from(AVATAR_BUCKET);

    const signed = await bucket.createSignedUrl(target, 60);
    expect(signed.data?.signedUrl ?? null).toBeNull();
    expect((await bucket.download(target)).data).toBeNull();
    expect(
      (
        await bucket.upload(target, jpeg(6), {
          contentType: "image/jpeg",
          upsert: true,
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await bucket.upload(`${a.user.id}/other.jpg`, jpeg(6), {
          contentType: "image/jpeg",
        })
      ).error,
    ).not.toBeNull();
    await bucket.remove([target]);
    expect(await objects(a.user.id)).toEqual(["avatar.jpg"]);
    // 내 프로필이 남의 사진 경로를 가리키게 할 수 없음
    expect(
      (
        await b.client
          .from("profiles")
          .update({ avatar_path: target })
          .eq("id", b.user.id)
      ).error,
    ).not.toBeNull();
    // 남의 프로필 행은 보이지도, 바뀌지도 않음
    expect(
      (await b.client.from("profiles").select("id").eq("id", a.user.id)).data,
    ).toEqual([]);
    await b.client
      .from("profiles")
      .update({ display_name: "해킹" })
      .eq("id", a.user.id);
    const aRow = (
      await adminClient()
        .from("profiles")
        .select("display_name, avatar_path")
        .eq("id", a.user.id)
        .single()
    ).data!;
    expect(aRow).toEqual({ display_name: "주인", avatar_path: target });
    // 주인의 사진은 그대로
    expect(
      (
        await download(
          (await new SupabaseProfileStore(a.client).get()).avatarUrl!,
        )
      )[10],
    ).toBe(5);
  });

  it("회원 탈퇴 → 프로필 사진 파일도 삭제", async () => {
    const a = await newUser("avatar-delete");
    await new SupabaseProfileStore(a.client).save({ avatar: jpeg(4) });
    expect(await objects(a.user.id)).toEqual(["avatar.jpg"]);
    await new SupabaseAuthService(a.client).deleteAccount();
    expect(await objects(a.user.id)).toEqual([]);
    expect(
      (await adminClient().from("profiles").select("id").eq("id", a.user.id))
        .data,
    ).toEqual([]);
  });
});
