import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/layout';
import { MAX_PHOTOS, pickPdf, pickPhotos } from '@/features/registration/pickers';
import { useRegistration } from '@/features/registration/store';
import { colors, radius, spacing } from '@/theme';

/**
 * 등록 방식 선택.
 */
export default function RegisterMethodScreen() {
  const start = useRegistration((s) => s.start);

  const onPdf = async () => {
    const files = await pickPdf();
    if (!files) return;
    start('pdf', files);
    router.push('/register/analyzing');
  };

  const onPhotos = async () => {
    const files = await pickPhotos();
    if (!files) return;
    start('photo', files);
    router.push('/register/analyzing');
  };

  return (
    <Screen edges={['bottom']}>
      <View style={styles.intro}>
        <AppText variant="title2">어떤 방법으로 계약을{'\n'}등록할까요?</AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          계약서를 넣으면 날짜·금액·갱신 조건을 정리해 드려요.{'\n'}저장 전에 내용을 직접 확인할 수 있어요.
        </AppText>
      </View>

      <View style={styles.options}>
        <Option icon="document-outline" title="PDF 업로드" desc="전자계약서, 스캔한 계약서" onPress={onPdf} testID="method-pdf" />
        <Option icon="images-outline" title="사진 업로드" desc={`종이 계약서 사진 (최대 ${MAX_PHOTOS}장)`} onPress={onPhotos} testID="method-photo" />
        <Option icon="create-outline" title="직접 입력" desc="계약서 없이 정보만 입력" onPress={() => router.push('/register/manual')} testID="method-manual" />
      </View>

      <View style={styles.privacy}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
          계약서는 본인만 열람할 수 있는 비공개 저장소에 보관되며, 공개 링크로 공유되지 않습니다. 지원되는 문서(글자로 된 PDF)에서는 주민등록번호·계좌번호 등 민감정보를 찾아 가려서 표시합니다.
        </AppText>
      </View>
    </Screen>
  );
}

function Option({ icon, title, desc, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; desc: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.bgPressed }]}>
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {desc}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  options: { paddingHorizontal: spacing.gutter, gap: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bgSubtle },
  optionIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  privacy: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.gutter, marginTop: spacing.xxl },
});
