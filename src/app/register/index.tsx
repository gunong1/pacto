import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/layout';
import { ensureCameraPermission, openAppSettings } from '@/features/registration/camera';
import { MAX_PHOTOS, pickPdf, pickPhotos } from '@/features/registration/pickers';
import { useRegistration } from '@/features/registration/store';
import { confirm } from '@/lib/dialog';
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

  const [sheet, setSheet] = useState(false);

  const onAlbum = async () => {
    setSheet(false);
    const files = await pickPhotos();
    if (!files) return;
    start('photo', files, 'album');
    router.push('/register/analyzing');
  };

  const onCamera = async () => {
    setSheet(false);
    const permission = await ensureCameraPermission();
    if (permission !== 'granted') {
      // 처음 거부: 다시 물어볼 수 있음 / 영구 거부: 설정에서만 허용 가능
      const go = await confirm('카메라 권한이 필요해요', '계약서를 직접 촬영하려면 카메라 접근 권한을 허용해주세요.', permission === 'blocked' ? '설정 열기' : '다시 요청');
      if (!go) return;
      if (permission === 'blocked') openAppSettings();
      else if ((await ensureCameraPermission()) === 'granted') router.push('/register/capture');
      return;
    }
    router.push('/register/capture');
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
        <Option icon="camera-outline" title="사진으로 등록" desc="종이 계약서를 촬영하거나 사진 선택" onPress={() => setSheet(true)} testID="method-photo" />
        <Option icon="create-outline" title="직접 입력" desc="계약서 없이 정보만 입력" onPress={() => router.push('/register/manual')} testID="method-manual" />
      </View>

      <View style={styles.privacy}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
          계약서는 비공개로 보관됩니다.{'\n'}지원되는 PDF에서는 민감정보를 찾아 가려서 표시합니다.
        </AppText>
      </View>

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setSheet(false)} accessibilityLabel="닫기" testID="photo-sheet-close" />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID="photo-sheet">
          <View style={styles.handle} />
          <AppText variant="title3" style={{ marginBottom: spacing.md }}>
            계약서 사진 등록
          </AppText>
          <Option icon="camera-outline" title="지금 촬영하기" desc="종이 계약서를 카메라로 촬영" onPress={onCamera} testID="photo-camera" />
          <View style={{ height: spacing.sm }} />
          <Option icon="images-outline" title="앨범에서 선택" desc={`촬영해둔 계약서 사진 선택 (최대 ${MAX_PHOTOS}장)`} onPress={onAlbum} testID="photo-album" />
        </SafeAreaView>
      </Modal>
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
  scrim: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
});
