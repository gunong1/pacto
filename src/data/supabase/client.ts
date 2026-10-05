import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env, isSupabaseConfigured } from '@/lib/env';
import type { Database } from '@/types/database';

import { LargeSecureStore } from './secureSessionStorage';

export type PactoSupabase = SupabaseClient<Database>;

function create(): PactoSupabase | null {
  if (!isSupabaseConfigured) return null;
  const isWeb = Platform.OS === 'web';
  const client = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      // 웹 미리보기는 브라우저 기본 저장소, 기기에서는 암호화 저장
      storage: isWeb ? undefined : new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // 콜백 화면에서 code를 직접 교환 (PKCE)
      flowType: 'pkce',
    },
  });
  if (!isWeb) {
    // 앱이 포그라운드일 때만 토큰 자동 갱신
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }
  return client;
}

/** Supabase 미설정(mock 모드)이면 null */
export const supabase: PactoSupabase | null = create();

export function requireSupabase(): PactoSupabase {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다 (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)');
  return supabase;
}
