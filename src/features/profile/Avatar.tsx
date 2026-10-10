import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { colors } from "@/theme";

/** 원형 프로필 사진 — 사진이 없으면 기본 아바타 */
export function Avatar({
  uri,
  size = 52,
  testID,
}: {
  uri: string | null | undefined;
  size?: number;
  testID?: string;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.avatar, box]} testID={testID}>
      {uri ? (
        <Image
          source={{ uri }}
          style={box}
          contentFit="cover"
          cachePolicy="memory"
          accessibilityLabel="프로필 사진"
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <Ionicons
          name="person"
          size={Math.round(size / 2)}
          color={colors.textTertiary}
          accessibilityLabel="기본 프로필"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
