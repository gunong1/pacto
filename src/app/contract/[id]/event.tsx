import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Screen, Section } from '@/components/ui/layout';
import { normalizeDateInput } from '@/domain/dates';
import { useContract, useContractActions, useToday } from '@/features/contracts/queries';
import { confirm } from '@/lib/dialog';
import { spacing } from '@/theme';

/** 계약에 사용자 일정 추가/수정/삭제 (예: 재계약 의사 확인, 해지 신청서 제출). ?eventId= 이면 수정 */
export default function EventScreen() {
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId?: string }>();
  const today = useToday();
  const { data: record } = useContract(id);
  const existing = eventId ? record?.events.find((e) => e.id === eventId) : undefined;
  const { addEvent, updateEvent, removeEvent } = useContractActions(id);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.eventDate ?? today);
  const [touched, setTouched] = useState(false);

  const titleError = touched && !title.trim() ? '일정 이름을 입력해주세요' : undefined;
  const normalizedDate = normalizeDateInput(date);
  const dateError = touched && !normalizedDate ? '올바른 날짜가 아니에요 (예: 261012 또는 2026-10-12)' : undefined;
  const busy = addEvent.isPending || updateEvent.isPending || removeEvent.isPending;

  const save = () => {
    setTouched(true);
    if (!title.trim() || !normalizedDate) return;
    const input = { title, eventDate: normalizedDate, eventType: 'custom' as const };
    if (eventId) updateEvent.mutate([eventId, input], { onSuccess: () => router.back() });
    else addEvent.mutate([input], { onSuccess: () => router.back() });
  };

  const remove = async () => {
    if (!eventId || !(await confirm('일정 삭제', '이 일정을 삭제할까요?', '삭제'))) return;
    removeEvent.mutate([eventId], { onSuccess: () => router.back() });
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label={eventId ? '저장' : '일정 추가'} onPress={save} loading={busy} testID="save-event" />
          {eventId ? <Button label="일정 삭제" variant="ghost" onPress={remove} testID="delete-event" /> : null}
        </View>
      }>
      <Stack.Screen options={{ title: eventId ? '일정 수정' : '일정 추가' }} />
      <Section>
        <View style={{ height: spacing.sm }} />
        <TextField label="일정 이름" value={title} onChangeText={setTitle} placeholder="예: 집주인에게 재계약 여부 확인" error={titleError} testID="event-title" />
        <DateField label="날짜" value={date} onChangeText={setDate} error={dateError} testID="event-date" />
      </Section>
    </Screen>
  );
}
