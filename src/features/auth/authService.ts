import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase, type PactoSupabase } from '@/data/supabase/client';
import { env } from '@/lib/env';

export interface AuthUser {
  id: string;
  email: string | null;
  provider: string;
}

export interface SignUpConsents {
  termsAgreed: boolean;
  privacyAgreed: boolean;
  aiProcessingAgreed: boolean;
}

export type OAuthProvider = 'apple' | 'google';

/**
 * 인증 추상화. Supabase가 설정되면 실제 인증, 아니면 미리보기용 mock.
 * 화면은 이 인터페이스만 사용한다.
 */
export interface AuthService {
  readonly mode: 'supabase' | 'mock';
  getUser(): Promise<AuthUser | null>;
  onChange(listener: (user: AuthUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<void>;
  /** 이메일 인증이 필요한 설정이면 needsEmailConfirmation = true (세션 없음) */
  signUpWithEmail(email: string, password: string, consents: SignUpConsents): Promise<{ needsEmailConfirmation: boolean }>;
  signInWithProvider(provider: OAuthProvider): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  /** 메일 링크/OAuth 콜백의 code → 세션 */
  exchangeCode(code: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  /** 원본 계약서 파일 + 모든 계약 데이터 + 계정 삭제 */
  deleteAccount(): Promise<void>;
}

/** 사용자에게 보여줄 오류 (원문 오류/개인정보를 그대로 노출하지 않음) */
export class AuthFailure extends Error {}

const MESSAGES: Record<string, string> = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않아요.',
  user_already_exists: '이미 가입된 이메일이에요. 로그인해주세요.',
  email_exists: '이미 가입된 이메일이에요. 로그인해주세요.',
  weak_password: '비밀번호를 더 안전하게 만들어주세요. (8자 이상)',
  email_not_confirmed: '이메일 인증을 먼저 완료해주세요. 받은 메일의 링크를 눌러주세요.',
  over_email_send_rate_limit: '메일을 너무 자주 요청했어요. 잠시 후 다시 시도해주세요.',
  over_request_rate_limit: '요청이 많아요. 잠시 후 다시 시도해주세요.',
  same_password: '이전과 다른 비밀번호를 입력해주세요.',
  validation_failed: '입력한 정보를 확인해주세요.',
  flow_state_expired: '링크가 만료되었어요. 다시 요청해주세요.',
  bad_code_verifier: '링크를 처음 요청한 기기에서 열어주세요.',
};

export function authErrorMessage(e: unknown): string {
  if (e instanceof AuthFailure) return e.message;
  const code = (e as { code?: string } | null)?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return '처리하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.';
}

function fail(error: unknown): never {
  throw error instanceof Error ? error : new Error('auth_error');
}

function toUser(u: { id: string; email?: string | null; app_metadata?: { provider?: string } } | null | undefined): AuthUser | null {
  return u ? { id: u.id, email: u.email ?? null, provider: u.app_metadata?.provider ?? 'email' } : null;
}

const redirect = (path: string) => Linking.createURL(path);

export class SupabaseAuthService implements AuthService {
  readonly mode = 'supabase' as const;
  constructor(private readonly sb: PactoSupabase) {}

  async getUser() {
    const { data } = await this.sb.auth.getSession();
    return toUser(data.session?.user);
  }

  onChange(listener: (user: AuthUser | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => listener(toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }

  async signInWithEmail(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) fail(error);
  }

  async signUpWithEmail(email: string, password: string, c: SignUpConsents) {
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: redirect('auth/callback'),
        data: { terms_agreed: c.termsAgreed, privacy_agreed: c.privacyAgreed, ai_processing_agreed: c.aiProcessingAgreed },
      },
    });
    if (error) fail(error);
    // 이미 가입된 이메일이면 identities가 비어 있음 (계정 존재 여부 노출 방지 동작)
    if (data.user && data.user.identities?.length === 0) throw new AuthFailure(MESSAGES.user_already_exists);
    return { needsEmailConfirmation: !data.session };
  }

  /** 대시보드에서 해당 로그인 공급자를 켰는지 확인 (꺼져 있으면 오류 페이지 대신 안내) */
  private async isProviderEnabled(provider: OAuthProvider): Promise<boolean> {
    try {
      const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey } });
      if (!res.ok) return true; // 확인 실패 시 기존 흐름대로 진행
      const settings = (await res.json()) as { external?: Record<string, boolean> };
      return settings.external?.[provider] !== false;
    } catch {
      return true;
    }
  }

  async signInWithProvider(provider: OAuthProvider) {
    if (!(await this.isProviderEnabled(provider))) {
      throw new AuthFailure(`${provider === 'apple' ? 'Apple' : 'Google'} 로그인은 아직 준비 중이에요. 이메일로 계속해주세요.`);
    }
    const redirectTo = redirect('auth/callback');
    const { data, error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
    if (error) fail(error);
    if (Platform.OS === 'web') {
      window.location.assign(data.url);
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') throw new AuthFailure('로그인을 취소했어요.');
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new AuthFailure('로그인을 완료하지 못했어요. 다시 시도해주세요.');
    await this.exchangeCode(code);
  }

  async sendPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect('reset-password') });
    if (error) fail(error);
  }

  async exchangeCode(code: string) {
    const { error } = await this.sb.auth.exchangeCodeForSession(code);
    if (error) fail(error);
  }

  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) fail(error);
  }

  async signOut() {
    const { error } = await this.sb.auth.signOut();
    if (error) fail(error);
  }

  async deleteAccount() {
    const { data, error } = await this.sb.functions.invoke<{ deleted?: boolean }>('delete-account', { method: 'POST' });
    if (error || !data?.deleted) throw new AuthFailure('탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해주세요.');
    // 서버에서 계정이 삭제되었으므로 기기의 세션만 정리
    await this.sb.auth.signOut({ scope: 'local' });
  }
}

/** Supabase 미설정 시 미리보기용. 어떤 계정으로도 로그인되며 데이터는 mock. */
class MockAuthService implements AuthService {
  readonly mode = 'mock' as const;
  private user: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null) => void>();

  private set(u: AuthUser | null) {
    this.user = u;
    this.listeners.forEach((l) => l(u));
  }

  async getUser() {
    return this.user;
  }
  onChange(listener: (user: AuthUser | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async signInWithEmail(email: string) {
    this.set({ id: 'mock-user', email: email || 'preview@pacto.app', provider: 'email' });
  }
  async signUpWithEmail(email: string) {
    this.set({ id: 'mock-user', email, provider: 'email' });
    return { needsEmailConfirmation: false };
  }
  async signInWithProvider(provider: OAuthProvider) {
    this.set({ id: 'mock-user', email: null, provider });
  }
  async sendPasswordReset() {}
  async exchangeCode() {}
  async updatePassword() {}
  async signOut() {
    this.set(null);
  }
  async deleteAccount() {
    this.set(null);
  }
}

export const authService: AuthService = supabase ? new SupabaseAuthService(supabase) : new MockAuthService();
