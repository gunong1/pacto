import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { colors, radius, spacing } from '@/theme';

export const PDF_PASSWORD_COPY = {
  title: '비밀번호가 설정된 계약서예요',
  body: '계약서를 확인하려면 PDF 비밀번호를 입력해주세요.\n입력한 비밀번호는 저장하지 않습니다.',
  invalid: '비밀번호가 맞지 않아요.\n다시 확인해주세요.',
  unknown: '이 PDF의 비밀번호를 확인할 수 없어요.\n비밀번호를 확인하거나 잠금이 해제된 파일을 다시 등록해주세요.',
  unsupported: '이 PDF의 보안 방식은 현재 지원하지 않습니다.\n잠금이 해제된 PDF를 다시 등록해주세요.',
} as const;

export interface PdfPasswordFormProps {
  /** 여러 파일 중 어느 파일인지 (예: "파일 2 · 계약서.pdf") */
  fileLabel?: string | null;
  /** 직전 입력이 틀렸음 (저장되지 않는 한 번의 결과) */
  invalid?: boolean;
  busy?: boolean;
  submitLabel?: string;
  onSubmit: (password: string) => void;
  /** "비밀번호를 모르겠어요" */
  onUnknown?: () => void;
  onCancel?: () => void;
}

/**
 * PDF 비밀번호 입력 — 입력값은 이 컴포넌트 상태(메모리)에만 있고, 제출하면 바로 비운다.
 * 자동완성·비밀번호 저장 제안을 끈다 (기기·키체인에 남지 않도록).
 */
export function PdfPasswordForm({ fileLabel, invalid, busy, submitLabel = '계약서 열기', onSubmit, onUnknown, onCancel }: PdfPasswordFormProps) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value) return;
    const pw = value;
    setValue('');
    onSubmit(pw);
  };
  return (
    <View style={styles.form} testID="pdf-password">
      <AppText variant="title2">{PDF_PASSWORD_COPY.title}</AppText>
      <AppText variant="body2" color="textSecondary">
        {PDF_PASSWORD_COPY.body}
      </AppText>
      {fileLabel ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {fileLabel}
        </AppText>
      ) : null}
      <TextField
        label="PDF 비밀번호"
        placeholder="PDF 비밀번호"
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        onSubmitEditing={submit}
        returnKeyType="go"
        error={invalid ? PDF_PASSWORD_COPY.invalid : undefined}
        testID="pdf-password-input"
      />
      <Button label={submitLabel} loading={busy} disabled={!value || busy} onPress={submit} testID="pdf-password-submit" />
      {onUnknown ? <Button label="비밀번호를 모르겠어요" variant="ghost" onPress={onUnknown} testID="pdf-password-unknown" /> : null}
      {onCancel ? <Button label="취소" variant="ghost" onPress={onCancel} testID="pdf-password-cancel" /> : null}
    </View>
  );
}

/** 같은 입력을 시트(모달)로 — 계약 상세·원본 보기에서 */
export function PdfPasswordModal({ visible, ...props }: PdfPasswordFormProps & { visible: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>{visible ? <PdfPasswordForm {...props} /> : null}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.gutter },
  sheet: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.gutter },
});
