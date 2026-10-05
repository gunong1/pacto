/**
 * 앱 환경 변수. EXPO_PUBLIC_* 값은 앱 번들에 그대로 포함되므로 공개 가능한 값만 둔다.
 * (Supabase URL + anon/publishable key만. service_role 키·AI API 키는 절대 넣지 않는다)
 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

/** Supabase 설정이 없으면 mock 데이터로 동작 (미리보기·UI 개발용) */
export const isSupabaseConfigured = env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
