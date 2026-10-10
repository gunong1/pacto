import type { ContractDocument, ContractRecord } from '@/domain/types';

export interface ArchivedDocument {
  record: ContractRecord;
  doc: ContractDocument;
}

/**
 * 보관 문서 = 계약에 연결된 원본 파일 (계약서·사진·PDF). MY 숫자와 "보관 문서" 화면이 같은 기준을 쓴다.
 * - 계약에 연결되지 않은 업로드(등록을 마치지 않은 원본)는 계약 목록에 없으므로 포함되지 않는다
 * - 보호본(protected_view) 같은 파생 파일은 원본 1개에 딸린 것이라 따로 세지 않는다
 * - 같은 문서가 두 번 들어오지 않게 id로 한 번 더 거른다
 */
export function archivedDocuments(records: readonly ContractRecord[] | undefined): ArchivedDocument[] {
  const seen = new Set<string>();
  const out: ArchivedDocument[] = [];
  for (const record of records ?? []) {
    for (const doc of record.documents) {
      if (seen.has(doc.id) || doc.contractId !== record.contract.id) continue;
      seen.add(doc.id);
      out.push({ record, doc });
    }
  }
  return out;
}

/** 문서가 있는 계약 수 (문서 개수와 다름) */
export const contractsWithDocuments = (records: readonly ContractRecord[] | undefined) => new Set(archivedDocuments(records).map((d) => d.record.contract.id)).size;
