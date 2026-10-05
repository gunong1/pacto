import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { Divider, ListRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { useContracts } from '@/features/contracts/queries';
import { useSession } from '@/features/session/store';
import { notify as notice } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

export default function MyScreen() {
  const { displayName, provider, signOut } = useSession();
  const { data } = useContracts();
  const docs = data?.reduce((n, r) => n + r.documents.length, 0) ?? 0;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title1">MY</AppText>
      </View>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={26} color={colors.textTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="title3">{displayName ?? '팩토 사용자'}</AppText>
          <AppText variant="caption" color="textTertiary">
            {provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : '이메일'} 계정 · 미리보기 모드
          </AppText>
        </View>
      </View>
      <View style={styles.stats}>
        <Stat label="보관 중인 계약" value={`${data?.length ?? 0}건`} />
        <Stat label="원본 계약서" value={`${docs}개`} />
      </View>

      <SectionGap />
      <Section title="설정">
        <ListRow title="알림 설정" subtitle="만료 90·30·7일 전, 해지 통보기한, 결제일" chevron onPress={() => router.push('/notifications')} />
        <Divider />
        <ListRow title="보안" subtitle="앱 잠금(Face ID·지문)" right={<Badge label="준비중" />} />
        <Divider />
        <ListRow title="데이터 내보내기" right={<Badge label="준비중" />} />
      </Section>
      <SectionGap />
      <Section title="안내">
        <ListRow title="이용약관 · 개인정보처리방침" chevron onPress={() => notice('준비중', '정식 출시 전에 제공됩니다.')} />
        <Divider />
        <ListRow title="계약서 정리 기능 안내" subtitle="자동 정리 결과는 법률 자문이 아닙니다" chevron onPress={() => notice('계약서 자동 정리', 'PACTO는 계약서 내용을 읽어 날짜·금액·조건을 정리해드립니다. 정리된 내용은 반드시 확인 후 저장해주세요. 법률 자문이 아닙니다.')} />
      </Section>
      <SectionGap />
      <Section>
        <ListRow title="로그아웃" onPress={signOut} testID="sign-out" />
        <Divider />
        <ListRow title="회원 탈퇴" subtitle="계약서 원본과 모든 데이터가 삭제됩니다 (Step 6에서 연결)" right={<Badge label="준비중" />} />
      </Section>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="title3" tabular>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.xl },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', paddingHorizontal: spacing.gutter, paddingVertical: spacing.xl, gap: spacing.xl },
  stat: { gap: 2 },
});
