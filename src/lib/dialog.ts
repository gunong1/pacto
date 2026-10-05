import { Alert, Platform } from 'react-native';

/** 플랫폼 공통 확인 대화상자 (웹 미리보기에서도 동작). */
export function confirm(title: string, message: string, okLabel = '확인'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]),
  );
}

export function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
