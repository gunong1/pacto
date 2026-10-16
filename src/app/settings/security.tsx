import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ChipGroup, SwitchRow } from '@/components/ui/controls';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { deviceAuthMessage, LOCK_GRACE_OPTIONS, type LockGrace } from '@/domain/appLock';
import { setAppLockEnabled, setAppLockGrace, useAppLock } from '@/features/security/appLock';
import { deviceLockStatus, openDeviceLockSettings, type DeviceLockStatus } from '@/features/security/deviceAuth';
import { notify } from '@/lib/dialog';
import { spacing } from '@/theme';

export const APP_LOCK_DESCRIPTION = '지문·얼굴인식 또는 기기 잠금으로 PACTO를 보호합니다.';

/**
 * MY > 보안 — 앱 잠금 (선택)
 * - 켜기·끄기·잠금 시점 변경은 기기 인증 후에만. 취소하면 그대로.
 * - 기기에 화면 잠금이 없으면 켤 수 없고, 기기 설정으로 안내한다.
 */
export default function SecurityScreen() {
  const { enabled, grace } = useAppLock();
  const [status, setStatus] = useState<DeviceLockStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () => deviceLockStatus().then(setStatus);
    check();
    // 기기 설정에서 화면 잠금을 만들고 돌아오면 다시 확인
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  const toggle = async (next: boolean) => {
    if (busy) return;
    if (next && status !== 'available') return;
    setBusy(true);
    const r = await setAppLockEnabled(next);
    setBusy(false);
    const msg = deviceAuthMessage(r);
    if (msg) notify('앱 잠금', msg);
  };

  const changeGrace = async (g: LockGrace) => {
    if (busy || g === grace) return;
    setBusy(true);
    const r = await setAppLockGrace(g);
    setBusy(false);
    const msg = deviceAuthMessage(r);
    if (msg) notify('잠금 시점', msg);
  };

  const unavailable = status === 'no_device_lock' || status === 'unsupported';
  return (
    <Screen edges={[]}>
      <Section title="앱 잠금" testID="security-app-lock">
        <View style={{ opacity: unavailable && !enabled ? 0.5 : 1 }} pointerEvents={busy || status === null || (unavailable && !enabled) ? 'none' : 'auto'}>
          <SwitchRow label="앱 잠금" description={APP_LOCK_DESCRIPTION} value={enabled} onValueChange={toggle} testID="app-lock-switch" />
        </View>
        {status === 'no_device_lock' && !enabled ? (
          <View style={{ paddingHorizontal: spacing.gutter, paddingBottom: spacing.md, gap: spacing.sm }} testID="app-lock-no-device-lock">
            <AppText variant="caption" color="textSecondary">
              이 기기에 화면 잠금(PIN·패턴·비밀번호 또는 지문·얼굴인식)이 설정되어 있지 않아요. 기기 설정에서 화면 잠금을 먼저 설정해 주세요.
            </AppText>
            <Button label="기기 설정 열기" variant="secondary" size="md" onPress={openDeviceLockSettings} testID="app-lock-open-settings" />
          </View>
        ) : null}
        {status === 'unsupported' && !enabled ? (
          <AppText variant="caption" color="textSecondary" style={{ paddingHorizontal: spacing.gutter, paddingBottom: spacing.md }} testID="app-lock-unsupported">
            이 환경에서는 앱 잠금을 사용할 수 없어요. 휴대폰 앱에서 설정해 주세요.
          </AppText>
        ) : null}
      </Section>
      {enabled ? (
        <>
          <SectionGap />
          <Section title="잠금 시점" caption="다른 앱을 쓰다가 PACTO로 돌아올 때 언제부터 다시 잠글지 정해요. 앱을 새로 열면 항상 잠겨요." testID="app-lock-grace">
            <View style={{ paddingHorizontal: spacing.gutter, paddingBottom: spacing.md }} pointerEvents={busy ? 'none' : 'auto'}>
              <ChipGroup options={LOCK_GRACE_OPTIONS} value={grace} onChange={changeGrace} testIDPrefix="app-lock-grace" />
            </View>
          </Section>
        </>
      ) : null}
      <SectionGap />
      <View style={{ paddingHorizontal: spacing.gutter, gap: spacing.xs }}>
        <AppText variant="caption" color="textTertiary">
          · 지문·얼굴 정보와 기기 비밀번호는 휴대폰이 확인하며, PACTO에 저장되거나 전송되지 않아요.
        </AppText>
        <AppText variant="caption" color="textTertiary">
          · 잠금을 풀 수 없을 때는 잠금 화면에서 로그아웃한 뒤 다시 로그인할 수 있어요.
        </AppText>
        <AppText variant="caption" color="textTertiary">
          · 앱 잠금을 켜면 최근 앱 화면에 PACTO 내용이 보이지 않고, 화면 캡처가 제한돼요.
        </AppText>
      </View>
    </Screen>
  );
}
