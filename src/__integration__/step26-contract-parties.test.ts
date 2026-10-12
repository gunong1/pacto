/*
 * 계약 당사자 저장 (migration 20261024000001 · save_contract). 모든 값은 가짜
 * - parties(역할 + 이름)·user_party_role 저장·수정·조회
 * - 예전 계약: parties 없이 저장된 계약은 counterparty 그대로, 빈 목록 (자동 변환 없음)
 * - parties를 보내지 않은 수정은 저장된 당사자를 지우지 않음
 * - DB 제약: 배열만 · 내 역할 코드 형식
 */
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { partyRows, partyRowText } from '@/domain/parties';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const lease = (o: Partial<ContractDraft> = {}): ContractDraft => ({ ...EMPTY_DRAFT, title: '주택 임대차', contractKind: 'lease', contractType: 'lease', category: 'real_estate', ...o });

test('당사자 저장·수정·조회 + 예전 계약은 그대로', async () => {
  const a = await newUser('parties');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-08');
  const make = async (draft: ContractDraft) => (await repo.create({ draft, source: 'upload', documents: [], aiChecks: [] })).contract.id;

  // 1) 공동 임차인 + 한쪽 없음 없이 저장 → 그대로 조회
  const id = await make(lease({ parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }, { role: 'lessee', name: '이수진' }] }));
  let rec = (await repo.get(id))!;
  expect(rec.contract.parties).toEqual([{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }, { role: 'lessee', name: '이수진' }]);
  expect(rec.contract.userPartyRole).toBeNull();
  expect(partyRows(rec.contract).map((r) => `${r.label} ${partyRowText(r)}`)).toEqual(['임대인 김민수', '임차인 박지훈, 이수진']);

  // 2) 내 역할을 고르고 수정 → 저장
  await repo.update(id, { ...lease({ parties: rec.contract.parties, userPartyRole: 'lessee' }) });
  rec = (await repo.get(id))!;
  expect(rec.contract.userPartyRole).toBe('lessee');

  // 3) 예전 계약 (당사자 없이 상대방 이름만) → 자동 변환 없음
  const old = await make(lease({ counterparty: '홍길동' }));
  const o = (await repo.get(old))!;
  expect([o.contract.counterparty, o.contract.parties, o.contract.userPartyRole]).toEqual(['홍길동', [], null]);
  expect(partyRows(o.contract).map((r) => [r.label, partyRowText(r)])).toEqual([['계약 상대방', '홍길동']]);

  // 4) parties 키 없이 저장하는 예전 앱의 수정 → 저장된 당사자 유지
  const { error: rpcErr } = await a.client.rpc('save_contract', {
    p_contract_id: id,
    p_contract: { title: '주택 임대차 (예전 앱 수정)', category: 'real_estate', contract_type: 'lease', contract_kind: 'lease' },
  });
  expect(rpcErr).toBeNull();
  rec = (await repo.get(id))!;
  expect(rec.contract.title).toBe('주택 임대차 (예전 앱 수정)');
  expect(rec.contract.parties).toHaveLength(3);
  expect(rec.contract.userPartyRole).toBe('lessee');

  // 5) DB 제약
  const bad1 = await adminClient().from('contracts').update({ parties: { role: 'lessor' } } as never).eq('id', id);
  expect(bad1.error).not.toBeNull();
  const bad2 = await adminClient().from('contracts').update({ user_party_role: 'DROP TABLE' } as never).eq('id', id);
  expect(bad2.error).not.toBeNull();
});
