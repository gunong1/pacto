import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Divider, ListRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import type { ContractDocument, ContractRecord } from '@/domain/types';
import { useContracts } from '@/features/contracts/queries';
import { archivedDocuments } from '@/features/documents/archive';
import { documentKind, viewDocument } from '@/features/documents/openDocument';
import { colors, spacing } from '@/theme';

/** 문서 한 줄 부가 정보: 형식 · 보호 상태 */
function docMeta(doc: ContractDocument): string {
  const kind = documentKind(doc, 'original') === 'pdf' ? 'PDF' : '사진';
  const p = doc.protection;
  const state = p?.protectedViewPath ? '민감정보 보호됨' : p?.status === 'no_sensitive_data' ? '민감정보 찾지 못함' : '원본';
  return `${kind} · ${state}`;
}

/**
 * 보관 문서 — 계약에 연결된 원본 파일 목록 (MY의 "보관 문서 N개"와 같은 기준).
 * 계약별로 묶어 보여주고, 문서를 누르면 계약서 보기(보호본이 있으면 보호본, 원본은 확인 후)와 같은 방식으로 연다.
 */
export default function DocumentsScreen() {
  const { data, isLoading } = useContracts();
  const items = archivedDocuments(data);
  const groups: { record: ContractRecord; docs: ContractDocument[] }[] = [];
  for (const { record, doc } of items) {
    const g = groups.find((x) => x.record.contract.id === record.contract.id);
    if (g) g.docs.push(doc);
    else groups.push({ record, docs: [doc] });
  }

  return (
    <Screen edges={['bottom']} testID="documents-screen">
      <View style={styles.summary}>
        <AppText variant="body2" color="textSecondary" testID="documents-summary">
          {isLoading ? '불러오는 중…' : `문서 ${items.length}개 · 계약 ${groups.length}건`}
        </AppText>
      </View>
      {!isLoading && items.length === 0 ? (
        <Section>
          <AppText variant="body2" color="textTertiary" testID="documents-empty">
            보관 중인 문서가 없어요. 계약서를 등록하면 원본이 여기에 모여요.
          </AppText>
        </Section>
      ) : null}
      {groups.map(({ record, docs }, gi) => (
        <View key={record.contract.id}>
          {gi > 0 ? <SectionGap /> : null}
          <Section
            title={record.contract.title || '제목 없는 계약'}
            action={{ label: '계약 보기', onPress: () => router.push(`/contract/${record.contract.id}`) }}
            testID={`documents-group-${gi}`}>
            {docs.map((doc, i) => (
              <View key={doc.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={doc.fileName || `파일 ${i + 1}`}
                  subtitle={docMeta(doc)}
                  left={<Ionicons name={documentKind(doc, 'original') === 'pdf' ? 'document-text-outline' : 'image-outline'} size={20} color={colors.textTertiary} />}
                  chevron
                  onPress={() => viewDocument(doc)}
                  testID={`document-row-${doc.id}`}
                />
              </View>
            ))}
          </Section>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.sm },
});
