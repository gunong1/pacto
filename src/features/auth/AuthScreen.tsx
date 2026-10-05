import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Screen } from '@/components/ui/layout';
import { spacing } from '@/theme';

/** 인증 화면 공통 틀: 제목 + 설명 + 입력 + 하단 버튼 */
export function AuthScreen({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Screen edges={['bottom']} footer={footer}>
      <View style={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.md }}>
        <AppText variant="title1">{title}</AppText>
        {description ? (
          <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
            {description}
          </AppText>
        ) : null}
        <View style={{ marginTop: spacing.xxl }}>{children}</View>
      </View>
    </Screen>
  );
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const MIN_PASSWORD = 8;
