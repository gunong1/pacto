import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/controls";
import { Screen, Section } from "@/components/ui/layout";
import { NICKNAME_MAX, normalizeNickname, type Profile } from "@/data/profile";
import { Avatar } from "@/features/profile/Avatar";
import { pickAvatar, type PickedAvatar } from "@/features/profile/avatarImage";
import { useProfile, useSaveProfile } from "@/features/profile/queries";
import { useSession } from "@/features/session/store";
import { notify } from "@/lib/dialog";
import { colors, radius, spacing } from "@/theme";

/** 사진 변경은 "변경사항 저장"을 누를 때 반영한다 (그 전까지는 미리보기만) */
type AvatarChange =
  | { kind: "keep" }
  | { kind: "new"; picked: PickedAvatar }
  | { kind: "remove" };

/**
 * 프로필 편집 — 프로필 사진(선택·변경·삭제), 닉네임(2~20자), 이메일(읽기 전용).
 * 사진을 올리지 못해도 닉네임은 저장하고 기존 사진을 유지한다.
 */
export default function ProfileEditScreen() {
  const { data: profile, isError } = useProfile();
  if (!profile) {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.loading}>
          {isError ? (
            <AppText color="textSecondary">
              프로필을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
            </AppText>
          ) : (
            <ActivityIndicator color={colors.textTertiary} />
          )}
        </View>
      </Screen>
    );
  }
  return <ProfileForm profile={profile} />;
}

function ProfileForm({ profile }: { profile: Profile }) {
  const user = useSession((s) => s.user);
  const save = useSaveProfile();
  const [nickname, setNickname] = useState(profile.displayName ?? "");
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [error, setError] = useState<string | null>(null);

  const shownUri =
    avatar.kind === "new"
      ? avatar.picked.previewUri
      : avatar.kind === "remove"
        ? null
        : profile.avatarUrl;
  const hasPhoto = !!shownUri;

  const choose = async () => {
    try {
      const picked = await pickAvatar();
      if (picked) setAvatar({ kind: "new", picked });
    } catch {
      notify(
        "프로필 사진",
        "사진을 불러오지 못했어요. 다른 사진을 선택해주세요.",
      );
    }
  };

  const submit = async () => {
    const n = normalizeNickname(nickname);
    if ("error" in n) return setError(n.error);
    setError(null);
    try {
      const r = await save.mutateAsync({
        ...(n.value !== profile.displayName ? { displayName: n.value } : {}),
        ...(avatar.kind === "new"
          ? { avatar: avatar.picked.bytes }
          : avatar.kind === "remove"
            ? { avatar: "remove" as const }
            : {}),
      });
      if (r.avatarFailed) {
        setAvatar({ kind: "keep" });
        notify(
          "프로필 사진",
          "사진을 저장하지 못해 기존 사진을 유지했어요. 닉네임 등 다른 변경사항은 저장되었어요.",
        );
        return;
      }
      router.back();
    } catch {
      notify("프로필 편집", "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  };

  return (
    <Screen
      edges={["bottom"]}
      footer={
        <Button
          label="변경사항 저장"
          loading={save.isPending}
          onPress={submit}
          testID="profile-save"
        />
      }
    >
      <Section>
        <View style={styles.photo}>
          <Pressable
            onPress={choose}
            accessibilityRole="button"
            accessibilityLabel={
              hasPhoto ? "프로필 사진 변경" : "프로필 사진 선택"
            }
            testID="profile-avatar"
          >
            <Avatar uri={shownUri} size={96} testID="profile-avatar-view" />
          </Pressable>
          <View style={styles.photoActions}>
            <Button
              label={hasPhoto ? "사진 변경" : "사진 선택"}
              variant="secondary"
              size="sm"
              onPress={choose}
              testID="profile-avatar-choose"
            />
            {hasPhoto ? (
              <Button
                label="사진 삭제"
                variant="ghost"
                size="sm"
                onPress={() => setAvatar({ kind: "remove" })}
                testID="profile-avatar-remove"
              />
            ) : null}
          </View>
        </View>
        <TextField
          label="닉네임"
          placeholder={`2~${NICKNAME_MAX}자`}
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            if (error) setError(null);
          }}
          maxLength={NICKNAME_MAX + 10}
          autoCorrect={false}
          returnKeyType="done"
          error={error ?? undefined}
          testID="profile-nickname"
        />
        <View style={styles.readonly}>
          <AppText variant="captionStrong" color="textSecondary">
            이메일
          </AppText>
          <View style={styles.readonlyBox}>
            <AppText
              variant="body"
              color="textSecondary"
              numberOfLines={1}
              testID="profile-email"
            >
              {user?.email ?? "-"}
            </AppText>
          </View>
          <AppText variant="caption" color="textTertiary">
            이메일은 변경할 수 없어요.
          </AppText>
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", paddingVertical: spacing.xxl },
  photo: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  photoActions: { flexDirection: "row", gap: spacing.sm },
  readonly: { gap: spacing.xs, marginTop: spacing.lg },
  readonlyBox: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
  },
});
