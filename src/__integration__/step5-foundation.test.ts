import { anonClient, newUser, testFetch } from './helpers';

describe('Step 5 — Supabase 기반', () => {
  test('가입하면 프로필이 자동 생성되고 본인 프로필만 조회된다', async () => {
    const a = await newUser('a');
    await newUser('b');
    const { data, error } = await a.client.from('profiles').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.user.id }]);
  });

  test('로그인하지 않은 사용자(anon)는 계약 데이터에 접근할 수 없다', async () => {
    const { data, error } = await anonClient().from('contracts').select('id');
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  test('계약서 버킷은 private이며 공개 URL로 열람할 수 없다', async () => {
    const a = await newUser('a');
    const path = `${a.user.id}/probe.pdf`;
    const up = await a.client.storage.from('contract-files').upload(path, new Blob(['%PDF-1.4 probe'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    expect(up.error).toBeNull();
    const publicUrl = a.client.storage.from('contract-files').getPublicUrl(path).data.publicUrl;
    const res = await testFetch(publicUrl);
    expect(res.ok).toBe(false);
    await a.client.storage.from('contract-files').remove([path]);
  });
});
