/* 로컬 Supabase 통합 테스트 도우미. 서비스 키는 테스트(로컬)에서만 사용한다. */
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { Request, Response } from 'undici';

import type { Database } from '@/types/database';

interface LocalEnv {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

/**
 * 테스트용 fetch. jest-expo 환경은 RN fetch 폴리필을 쓰고, 그 안에서 undici fetch는 응답 본문 수신이
 * 가끔 멈춰(헤더 수신 후) 테스트가 시간 초과되므로 node:http로 요청하고 본문을 모두 받은 뒤 Response를 만든다.
 * 요청 본문(Blob·FormData 등) 직렬화는 undici Request에 맡긴다. 리다이렉트는 따라가지 않는다(manual과 동일).
 */
export const testFetch = (async (input: ConstructorParameters<typeof Request>[0], init?: ConstructorParameters<typeof Request>[1]) => {
  const req = new Request(input, init);
  const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  if (body) headers['content-length'] = String(body.byteLength);
  return new Promise<Response>((resolve, reject) => {
    const r = http.request(req.url, { method: req.method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null) for (const one of [v].flat()) out.append(k, String(one));
        const status = res.statusCode ?? 0;
        const noBody = status === 204 || status === 304 || req.method === 'HEAD';
        resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: out }));
      });
    });
    r.on('error', reject);
    req.signal.addEventListener('abort', () => r.destroy(new Error('aborted')));
    r.end(body);
  });
}) as unknown as typeof fetch;

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
