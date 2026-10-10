/**
 * 프로필(닉네임·프로필 사진) 저장소 — 화면은 이 인터페이스만 쓴다.
 * - Supabase: profiles.display_name / avatar_path + 비공개 Storage(profile-images/{user_id}/avatar.jpg), 표시할 때만 Signed URL
 * - Mock(미리보기): 메모리
 * 사진은 올리기 전에 정사각형 512px JPEG로 줄인다 (features/profile/avatarImage.ts).
 */
import type { PactoSupabase } from "./supabase/client";

export const AVATAR_BUCKET = "profile-images";
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
/** Signed URL 유효 시간 (초) — 화면에 보일 동안만 */
const AVATAR_URL_TTL = 60 * 60;

export interface Profile {
  displayName: string | null;
  /** 표시용 Signed URL (사진 없으면 null) */
  avatarUrl: string | null;
}

export interface ProfileChanges {
  /** 바꿀 닉네임 (undefined면 그대로, null이면 지움) */
  displayName?: string | null;
  /** 새 사진 (512px JPEG 바이트) / 'remove' = 삭제 / undefined = 그대로 */
  avatar?: ArrayBuffer | "remove";
}

export interface ProfileSaveResult {
  profile: Profile;
  /** 사진만 저장하지 못함 — 기존 사진은 그대로, 닉네임은 저장됨 */
  avatarFailed: boolean;
}

export interface ProfileStore {
  get(): Promise<Profile>;
  save(changes: ProfileChanges): Promise<ProfileSaveResult>;
}

export class ProfileError extends Error {}

/** 닉네임 정리·검사: 앞뒤 공백 제거, 2~20자. 빈 값은 "없음"(null). 형식 오류면 안내 문구 */
export function normalizeNickname(
  raw: string,
): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  const len = [...v].length;
  if (len < NICKNAME_MIN || len > NICKNAME_MAX)
    return {
      error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.`,
    };
  // 줄바꿈·제어문자만 막는다 (그 밖의 특수문자는 허용)
  if (/[\u0000-\u001f\u007f]/.test(v))
    return { error: "닉네임에 쓸 수 없는 문자가 있어요." };
  return { value: v };
}

export class SupabaseProfileStore implements ProfileStore {
  constructor(private readonly sb: PactoSupabase) {}

  private async userId(): Promise<string> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) throw new ProfileError("로그인이 필요해요.");
    return data.user.id;
  }

  private async signed(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.sb.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, AVATAR_URL_TTL);
    return data?.signedUrl ?? null;
  }

  async get(): Promise<Profile> {
    const id = await this.userId();
    const { data, error } = await this.sb
      .from("profiles")
      .select("display_name, avatar_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new ProfileError("프로필을 불러오지 못했어요.");
    return {
      displayName: data?.display_name ?? null,
      avatarUrl: await this.signed(data?.avatar_path ?? null),
    };
  }

  async save(changes: ProfileChanges): Promise<ProfileSaveResult> {
    const id = await this.userId();
    const path = `${id}/avatar.jpg`;
    const patch: { display_name?: string | null; avatar_path?: string | null } =
      {};
    if (changes.displayName !== undefined)
      patch.display_name = changes.displayName;
    let avatarFailed = false;
    // ① 새 사진: 같은 경로에 덮어쓴다 — 올리기가 실패하면 기존 파일·경로는 그대로 (닉네임 저장은 계속)
    if (changes.avatar instanceof ArrayBuffer) {
      const { error } = await this.sb.storage
        .from(AVATAR_BUCKET)
        .upload(path, changes.avatar, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "0",
        });
      if (error) avatarFailed = true;
      else patch.avatar_path = path;
    } else if (changes.avatar === "remove") {
      patch.avatar_path = null;
    }
    // ② 프로필 행
    if (Object.keys(patch).length) {
      const { error } = await this.sb
        .from("profiles")
        .update(patch)
        .eq("id", id);
      if (error) throw new ProfileError("프로필을 저장하지 못했어요.");
    }
    // ③ 사진 삭제: 경로를 먼저 비운 뒤 파일을 지운다 (파일 삭제가 실패해도 화면에는 기본 아바타 — 탈퇴 시 폴더째 삭제)
    if (changes.avatar === "remove")
      await this.sb.storage
        .from(AVATAR_BUCKET)
        .remove([path])
        .catch(() => undefined);
    return { profile: await this.get(), avatarFailed };
  }
}

/** 미리보기(mock) — 메모리. 사진은 data URL로 보관 */
export class MockProfileStore implements ProfileStore {
  private state: Profile = { displayName: null, avatarUrl: null };

  async get(): Promise<Profile> {
    return { ...this.state };
  }

  async save(changes: ProfileChanges): Promise<ProfileSaveResult> {
    const next = { ...this.state };
    if (changes.displayName !== undefined)
      next.displayName = changes.displayName;
    if (changes.avatar === "remove") next.avatarUrl = null;
    else if (changes.avatar instanceof ArrayBuffer)
      next.avatarUrl = `data:image/jpeg;base64,${toBase64(changes.avatar)}`;
    this.state = next;
    return { profile: { ...next }, avatarFailed: false };
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
