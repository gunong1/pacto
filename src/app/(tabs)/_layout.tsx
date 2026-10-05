import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Platform, Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { colors, radius } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    return <Ionicons name={focused ? active : inactive} size={23} color={color as string} />;
  }
  return TabIcon;
}

/** 하단 탭: 홈 / 계약 / (+) / 캘린더 / MY — AI 탭 없음 (AI는 계약 상세 안에서만). */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textDisabled,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, ...(Platform.OS === 'web' ? { height: 64, paddingBottom: 8 } : null) },
      }}>
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: tabIcon('home', 'home-outline'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="contracts" options={{ title: '계약', tabBarIcon: tabIcon('documents', 'documents-outline'), tabBarButtonTestID: 'tab-contracts' }} />
      <Tabs.Screen
        name="add"
        options={{
          title: '등록',
          tabBarButton: () => (
            <View style={styles.addWrap}>
              <Pressable
                onPress={() => router.push('/register')}
                accessibilityRole="button"
                accessibilityLabel="계약 등록"
                testID="tab-add"
                style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.primaryPressed }]}>
                <Ionicons name="add" size={28} color={colors.textInverse} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="calendar" options={{ title: '캘린더', tabBarIcon: tabIcon('calendar', 'calendar-outline'), tabBarButtonTestID: 'tab-calendar' }} />
      <Tabs.Screen name="my" options={{ title: 'MY', tabBarIcon: tabIcon('person', 'person-outline'), tabBarButtonTestID: 'tab-my' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  add: { width: 48, height: 40, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
