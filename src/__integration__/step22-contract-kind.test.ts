/*
 * 계약 종류 (contract_kind) 저장 — 분류 개편 (로컬 Supabase). 모든 값은 가짜
 * - DB 기준표(계약 종류·상세 분류) = 공용 레지스트리
 * - 새 계약: 계약 종류·상세 분류·분류 메타데이터 저장 + 하위 호환값(contract_type·category)은 레지스트리 호환값
 * - 상세 분류는 그 종류의 것만 (DB가 거부) · 기존 계약(종류 없음)은 그대로 · 예전 앱(종류 키 없이 저장)이 종류를 지우지 않음
 */
import { CONTRACT_KIND_DEFS } from '../../supabase/functions/_shared/contractRegistry';
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const saas: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '업무 협업 서비스 이용계약',
  contractKind: 'subscription_membership',
  contractSubtype: 'software_saas',
  classification: { confidence: 'high', alternatives: [], reason: '소프트웨어 사용권을 제공하는 계약', evidence: { quote: '제1조 (목적)', page: 1, fileIndex: 0 }, secondaryElements: [], domains: ['software'], source: 'ai' },
};

test('DB 기준표 = 레지스트리 (계약 종류 13 · 상세 분류)', async () => {
  const admin = adminClient();
  const kinds = (await admin.from('contract_kind_defs' as never).select('code,label')).data as unknown as { code: string; label: string }[];
  expect(kinds.map((k) => `${k.code}:${k.label}`).sort()).toEqual(CONTRACT_KIND_DEFS.map((k) => `${k.code}:${k.label}`).sort());
  const subs = (await admin.from('contract_subtype_defs' as never).select('kind,code,label')).data as unknown as { kind: string; code: string; label: string }[];
  expect(subs.map((s) => `${s.kind}.${s.code}:${s.label}`).sort()).toEqual(CONTRACT_KIND_DEFS.flatMap((k) => k.subtypes.map((s) => `${k.code}.${s.code}:${s.label}`)).sort());
});

test('새 계약: 계약 종류·상세 분류·메타데이터 저장, 호환값은 레지스트리 값', async () => {
  const a = await newUser('contract-kind');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
  const created = await repo.create({ draft: saas, source: 'upload', documents: [], aiChecks: [] });
  expect(created.contract).toMatchObject({ contractKind: 'subscription_membership', contractSubtype: 'software_saas', contractType: 'recurring', category: 'subscription' });
  expect(created.contract.classification).toEqual(saas.classification);

  // 예전 앱처럼 계약 종류 키 없이 저장해도 종류가 지워지지 않는다
  const { error } = await a.client.rpc('save_contract', { p_contract: { title: '이름만 바꿈', category: 'subscription', contract_type: 'recurring' }, p_contract_id: created.contract.id } as never);
  expect(error).toBeNull();
  const after = (await repo.get(created.contract.id))!;
  expect(after.contract).toMatchObject({ title: '이름만 바꿈', contractKind: 'subscription_membership', contractSubtype: 'software_saas' });
});

test('상세 분류가 다른 종류의 것이면 DB가 거부', async () => {
  const a = await newUser('contract-kind-bad');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
  await expect(repo.create({ draft: { ...saas, contractSubtype: 'vehicle' }, source: 'manual', documents: [], aiChecks: [] })).rejects.toBeTruthy();
});

test('기존 계약(종류 없음)은 그대로 — 호환값으로 저장·읽기', async () => {
  const a = await newUser('contract-kind-legacy');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
  const created = await repo.create({ draft: { ...EMPTY_DRAFT, title: '자동차 리스', category: 'vehicle', contractType: 'recurring' }, source: 'manual', documents: [], aiChecks: [] });
  expect(created.contract).toMatchObject({ contractKind: null, contractSubtype: null, contractType: 'recurring', category: 'vehicle' });
});
