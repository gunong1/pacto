import { SupabaseAuthService, authErrorMessage } from '@/features/auth/authService';

import { adminClient, anonClient, latestMailLink, newUser, testFetch } from './helpers';

const PW = 'pacto-test-password-1';
const email = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@pacto.test`;

describe('Step 6 — 이메일 인증', () => {
  test('가입 → 동의 기록 → 로그아웃 → 로그인 → 세션 유지', async () => {
    const client = anonClient();
    const auth = new SupabaseAuthService(client);
    const addr = email('signup');
    const res = await auth.signUpWithEmail(addr, PW, { termsAgreed: true, privacyAgreed: true, aiProcessingAgreed: false });
    expect(res.needsEmailConfirmation).toBe(false); // 로컬은 메일 인증 off
    const user = await auth.getUser();
    expect(user?.email).toBe(addr);

    const { data: profile } = await client.from('profiles').select('terms_agreed_at, privacy_agreed_at, ai_processing_agreed_at').single();
    expect(profile?.terms_agreed_at).not.toBeNull();
    expect(profile?.privacy_agreed_at).not.toBeNull();
    expect(profile?.ai_processing_agreed_at).toBeNull();

    await auth.signOut();
    expect(await auth.getUser()).toBeNull();

    await auth.signInWithEmail(addr, PW);
    expect((await auth.getUser())?.email).toBe(addr);
  });

  test('잘못된 비밀번호 / 중복 가입은 한국어 안내', async () => {
    const auth = new SupabaseAuthService(anonClient());
    const addr = email('dup');
    await auth.signUpWithEmail(addr, PW, { termsAgreed: true, privacyAgreed: true, aiProcessingAgreed: false });
    await auth.signOut();

    await expect(auth.signInWithEmail(addr, 'wrong-password-123')).rejects.toBeDefined();
    const e = await auth.signInWithEmail(addr, 'wrong-password-123').catch((x) => x);
    expect(authErrorMessage(e)).toBe('이메일 또는 비밀번호가 올바르지 않아요.');

    const dup = await auth.signUpWithEmail(addr, PW, { termsAgreed: true, privacyAgreed: true, aiProcessingAgreed: false }).catch((x) => x);
    expect(authErrorMessage(dup)).toContain('이미 가입된 이메일');
  });

  test('비밀번호 변경 후 새 비밀번호로 로그인', async () => {
    const auth = new SupabaseAuthService(anonClient());
    const addr = email('pw');
    await auth.signUpWithEmail(addr, PW, { termsAgreed: true, privacyAgreed: true, aiProcessingAgreed: false });
    await auth.updatePassword('pacto-new-password-2');
    await auth.signOut();
    await expect(auth.signInWithEmail(addr, PW)).rejects.toBeDefined();
    await auth.signInWithEmail(addr, 'pacto-new-password-2');
    expect((await auth.getUser())?.email).toBe(addr);
  });

  test('비밀번호 재설정: 메일 요청 → 링크 → code 교환 → 새 비밀번호', async () => {
    const { email: addr } = await newUser('reset');
    const client = anonClient();
    const auth = new SupabaseAuthService(client);
    await auth.sendPasswordReset(addr);

    // 메일 링크를 열면 Auth 서버가 앱 링크(pacto://reset-password?code=...)로 보낸다
    const link = await latestMailLink(addr);
    const res = await testFetch(link, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('pacto://reset-password')).toBe(true);
    const code = new URL(location.replace('pacto://', 'http://app/')).searchParams.get('code');
    expect(code).toBeTruthy();

    await auth.exchangeCode(code!);
    await auth.updatePassword('pacto-reset-password-3');
    await auth.signOut();
    await auth.signInWithEmail(addr, 'pacto-reset-password-3');
    expect((await auth.getUser())?.email).toBe(addr);
  });

  test('OAuth(Apple/Google) 로그인 URL 생성 (공급자 설정은 대시보드에서)', async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'pacto://auth/callback', skipBrowserRedirect: true } });
    expect(error).toBeNull();
    expect(data.url).toContain('/auth/v1/authorize?provider=google');
  });
});

describe('Step 6 — 회원 탈퇴', () => {
  test('원본 파일 + 계약 데이터 + 계정이 모두 삭제되고, 다른 사용자 데이터는 그대로', async () => {
    const a = await newUser('leaver');
    const b = await newUser('stayer');

    // A: 원본 업로드 + 계약 저장
    const path = `${a.user.id}/doc-1.pdf`;
    expect((await a.client.storage.from('contract-files').upload(path, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { contentType: 'application/pdf' })).error).toBeNull();
    const { data: doc } = await a.client.from('contract_documents').insert({ storage_path: path, mime_type: 'application/pdf', size_bytes: 8 }).select('id').single();
    const { data: cid, error } = await a.client.rpc('save_contract', { p_contract: { title: '탈퇴 테스트' }, p_document_ids: [doc!.id] });
    expect(error).toBeNull();
    // B: 계약 하나
    await b.client.rpc('save_contract', { p_contract: { title: 'B 계약' } });

    const auth = new SupabaseAuthService(a.client);
    await auth.deleteAccount();

    const admin = adminClient();
    expect((await admin.auth.admin.getUserById(a.user.id)).data.user).toBeNull();
    expect((await admin.from('contracts').select('id').eq('id', cid!)).data).toEqual([]);
    expect((await admin.from('contract_documents').select('id').eq('user_id', a.user.id)).data).toEqual([]);
    expect((await admin.from('profiles').select('id').eq('id', a.user.id)).data).toEqual([]);
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toEqual([]);
    expect((await admin.from('contracts').select('id').eq('user_id', b.user.id)).data).toHaveLength(1);
  });

  test('다른 사람 토큰 없이 탈퇴 함수 호출 불가', async () => {
    const { data, error } = await anonClient().functions.invoke('delete-account', { method: 'POST' });
    expect(data?.deleted).toBeUndefined();
    expect(error).not.toBeNull();
  });
});
