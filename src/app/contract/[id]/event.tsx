import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { Screen, Section } from '@/components/ui/layout';
import { isValidISODate } from '@/domain/dates';
import { useContractActions, useToday } from '@/features/contracts/queries';
import { spacing } from '@/theme';

/** 계약에 사용자 일정 추가 (예: 재계약 의사 확인, 해지 신청서 제출) */
export default function AddEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { addEvent } = useContractActions(id);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [touched, setTouched] = useState(false);

  const titleError = touched && !title.trim() ? '일정 이름을 입력해주세요' : undefined;
  const dateError = touched && !isValidISODate(date) ? '날짜를 2026-01-31 형식으로 입력해주세요' : undefined;

  const save = () => {
    setTouched(true);
    if (!title.trim() || !isValidISODate(date)) return;
    addEvent.mutate([{ title, eventDate: date, eventType: 'custom' }], { onSuccess: () => router.back() });
  };

  return (
    <Screen edges={['bottom']} footer={<Button label="일정 추가" onPress={save} loading={addEvent.isPending} testID="save-event" />}>
      <Section>
        <View style={{ height: spacing.sm }} />
        <TextField label="일정 이름" value={title} onChangeText={setTitle} placeholder="예: 집주인에게 재계약 여부 확인" error={titleError} testID="event-title" />
        <TextField label="날짜" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" maxLength={10} error={dateError} testID="event-date" />
      </Section>
    </Screen>
  );
}
