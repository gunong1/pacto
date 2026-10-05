import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/layout';
import type { PickedFile } from '@/data/ai/provider';
import { useRegistration } from '@/features/registration/store';
import { notify } from '@/lib/dialog';
import { colors, radius, spacing } from '@/theme';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PHOTOS = 10;

function tooLarge(files: PickedFile[]) {
  return files.some((f) => f.size != null && f.size > MAX_BYTES);
}

/**
 * 등록 방식 선택.
 * Step 1~4: 파일은 기기에서 선택만 하고 업로드하지 않는다 (업로드는 Step 8, 비공개 저장소).
 */
export default function RegisterMethodScreen() {
  const start = useRegistration((s) => s.start);

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (res.canceled) return;
    const files = res.assets.map((a) => ({ name: a.name, uri: a.uri, mimeType: a.mimeType ?? 'application/pdf', size: a.size ?? null }));
    if (tooLarge(files)) return notify('파일이 너무 커요', '20MB 이하의 PDF를 선택해주세요.');
    start('pdf', files);
    router.push('/register/analyzing');
  };

  const pickPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS, quality: 0.8 });
    if (res.canceled) return;
    const files = res.assets.map((a, i) => ({ name: a.fileName ?? `계약서_${i + 1}.jpg`, uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? null }));
    if (tooLarge(files)) return notify('사진이 너무 커요', '한 장당 20MB 이하로 선택해주세요.');
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
        <Option icon="document-outline" title="PDF 업로드" desc="전자계약서, 스캔한 계약서" onPress={pickPdf} testID="method-pdf" />
        <Option icon="images-outline" title="사진 업로드" desc={`종이 계약서 사진 (최대 ${MAX_PHOTOS}장)`} onPress={pickPhotos} testID="method-photo" />
        <Option icon="create-outline" title="직접 입력" desc="계약서 없이 정보만 입력" onPress={() => router.push('/register/manual')} testID="method-manual" />
      </View>

      <View style={styles.privacy}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
          계약서는 본인만 열람할 수 있는 비공개 저장소에 보관됩니다. (미리보기 버전에서는 기기 밖으로 전송되지 않아요)
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
