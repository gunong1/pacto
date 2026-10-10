import type { ContractDocument, ContractRecord } from '@/domain/types';

import { archivedDocuments, contractsWithDocuments } from '../archive';

const doc = (id: string, contractId: string): ContractDocument => ({ id, contractId, fileName: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storagePath: null, localUri: null, pageCount: null });
const rec = (id: string, docs: ContractDocument[]) => ({ contract: { id, title: id }, documents: docs }) as unknown as ContractRecord;

describe('보관 문서 개수 (MY 숫자와 보관 문서 화면의 같은 기준)', () => {
  test('계약 A 문서 2개 + 계약 B 문서 1개 + 문서 없는 계약 → 문서 3개 · 문서가 있는 계약 2건', () => {
    const records = [rec('A', [doc('a1', 'A'), doc('a2', 'A')]), rec('B', [doc('b1', 'B')]), rec('C', [])];
    expect(archivedDocuments(records).map((x) => [x.record.contract.id, x.doc.id])).toEqual([
      ['A', 'a1'],
      ['A', 'a2'],
      ['B', 'b1'],
    ]);
    expect(contractsWithDocuments(records)).toBe(2);
  });
  test('같은 문서가 두 번 오거나 다른 계약 문서가 섞여 와도 한 번만 · 그 계약 것만', () => {
    const records = [rec('A', [doc('a1', 'A'), doc('a1', 'A'), doc('x', 'Z')])];
    expect(archivedDocuments(records).map((x) => x.doc.id)).toEqual(['a1']);
  });
  test('불러오기 전(undefined) → 0', () => {
    expect(archivedDocuments(undefined)).toEqual([]);
    expect(contractsWithDocuments(undefined)).toBe(0);
  });
});
