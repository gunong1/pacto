/* 로컬 Supabase 통합 테스트 도우미. 서비스 키는 테스트(로컬)에서만 사용한다. */
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { fetch as nodeFetch } from 'undici';

import type { Database } from '@/types/database';

interface LocalEnv {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

// jest-expo 환경은 RN fetch 폴리필을 쓰므로 Node(undici) fetch를 명시적으로 사용
export const testFetch = nodeFetch as unknown as typeof fetch;

let cached: LocalEnv | null = null;
export function localEnv(): LocalEnv {
  if (cached) return cached;
  const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  cached = JSON.parse(out.slice(out.indexOf('{'))) as LocalEnv;
  return cached;
}

export function anonClient() {
  const e = localEnv();
  // 앱과 같은 PKCE 흐름 (메일 링크 → code 교환)
  return createClient<Database>(e.API_URL, e.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'pkce' }, global: { fetch: testFetch } });
}

export function adminClient() {
  const e = localEnv();
  return createClient<Database>(e.API_URL, e.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: testFetch } });
}

/** 새 테스트 계정으로 로그인된 클라이언트 */
export async function newUser(prefix = 'user') {
  const client = anonClient();
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@pacto.test`;
  const password = 'pacto-test-password-1';
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) throw error ?? new Error('signUp failed');
  return { client, user: data.user, email, password };
}

/** 로컬 메일 서버(Mailpit)에서 해당 주소로 온 마지막 메일의 링크 */
export async function latestMailLink(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = (await (await testFetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as { messages: { ID: string }[] };
    if (list.messages.length > 0) {
      const msg = (await (await testFetch(`http://127.0.0.1:54324/api/v1/message/${list.messages[0].ID}`)).json()) as { HTML: string; Text: string };
      const m = /href="([^"]+)"/.exec(msg.HTML) ?? /(https?:\/\/\S+)/.exec(msg.Text);
      if (m) return m[1].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('mail not found');
}
