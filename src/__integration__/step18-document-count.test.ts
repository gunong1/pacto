/*
 * 보관 문서 숫자 검증 (로컬 Supabase) — 모든 값은 가짜
 * MY "보관 문서 N개" = 계약에 연결된 원본 파일 수. 문서가 있는 계약 수와 다르다.
 * 넣지 않는 것: 계약에 연결되지 않은 업로드(등록 미완료·고아), 보호본(파생 파일), 삭제된 계약의 문서(계약과 함께 삭제)
 */
import { randomUUID } from 'node:crypto';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';
import { archivedDocuments, contractsWithDocuments } from '@/features/documents/archive';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const PDF = new TextEncoder().encode('%PDF-1.4\n% PACTO 테스트\n');
const prepare = async (f: { mimeType: string }): Promise<PreparedFile> =>
  f.mimeType === 'application/pdf' ? { bytes: PDF.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' } : { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]).buffer, mimeType: 'image/jpeg', ext: 'jpg' };
const file = (name: string, mimeType = 'application/pdf') => ({ name, uri: `file:///${name}`, mimeType, size: 100 });
const stores = (c: PactoSupabase) => ({ docs: new SupabaseDocumentStore(c, prepare, () => randomUUID()), repo: new SupabaseContractRepository(c, () => '2026-10-10') });

test('계약 A 문서 2개 + 계약 B 문서 1개 → 보관 문서 3개 · 문서가 있는 계약 2건 (고아·보호본·삭제된 계약 제외)', async () => {
  const a = await newUser('doc-count');
  const { docs, repo } = stores(a.client);
  const admin = adminClient();

  // 계약 A: 계약서 PDF + 부속문서 사진 / 계약 B: PDF 1개 / 계약 C: 문서 없음
  const a1 = await docs.upload(file('렌탈계약서.pdf'), { sortOrder: 0 });
  const a2 = await docs.upload(file('부속문서.jpg', 'image/jpeg'), { sortOrder: 1 });
  const b1 = await docs.upload(file('근로계약서.pdf'), { sortOrder: 0 });
  await repo.create({ draft: { ...EMPTY_DRAFT, title: '렌탈 서비스 계약' }, source: 'upload', documents: [a1, a2].map((d) => ({ ...d, pageCount: null })), aiChecks: [] });
  await repo.create({ draft: { ...EMPTY_DRAFT, title: '근로계약서' }, source: 'upload', documents: [{ ...b1, pageCount: null }], aiChecks: [] });
  await repo.create({ draft: { ...EMPTY_DRAFT, title: '문서 없는 계약' }, source: 'manual', documents: [], aiChecks: [] });

  // 고아: 올렸지만 계약에 연결하지 않음 (등록 중단)
  const orphan = await docs.upload(file('등록중단.pdf'));
  // 보호본(파생 파일) — 원본 a1에 딸린 파일
  await admin.from('document_derivatives').insert({ user_id: a.user.id, document_id: a1.id, kind: 'protected_view', storage_path: `${a.user.id}/${a1.id}.protected_view.pdf`, size_bytes: 10 });
  // 삭제된 계약: 문서도 함께 삭제됨
  const d1 = await docs.upload(file('삭제할계약.pdf'));
  const del = await repo.create({ draft: { ...EMPTY_DRAFT, title: '삭제할 계약' }, source: 'upload', documents: [{ ...d1, pageCount: null }], aiChecks: [] });
  await repo.remove(del.contract.id);

  // DB 실제 값
  const all = (await admin.from('contract_documents').select('id, contract_id').eq('user_id', a.user.id)).data!;
  expect(all).toHaveLength(4); // 연결 3 + 고아 1 (삭제된 계약의 문서는 없음)
  expect(all.filter((d) => d.contract_id === null).map((d) => d.id)).toEqual([orphan.id]);
  expect(all.some((d) => d.id === d1.id)).toBe(false);
  const linked = all.filter((d) => d.contract_id !== null).length;

  // 앱 기준 (MY 숫자·보관 문서 화면)
  const records = await repo.list();
  const archived = archivedDocuments(records);
  expect(archived).toHaveLength(3);
  expect(archived).toHaveLength(linked);
  expect(archived.map((x) => [x.record.contract.title, x.doc.fileName])).toEqual(
    expect.arrayContaining([
      ['렌탈 서비스 계약', '렌탈계약서.pdf'],
      ['렌탈 서비스 계약', '부속문서.jpg'],
      ['근로계약서', '근로계약서.pdf'],
    ]),
  );
  expect(contractsWithDocuments(records)).toBe(2);
  expect(archived.some((x) => x.doc.id === orphan.id)).toBe(false);
});
