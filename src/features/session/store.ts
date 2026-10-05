import { create } from 'zustand';

/**
 * Step 1~4용 mock 세션. Step 6에서 Supabase Auth 세션으로 교체.
 */
interface SessionState {
  signedIn: boolean;
  displayName: string | null;
  provider: 'email' | 'apple' | 'google' | null;
  signIn: (provider: 'email' | 'apple' | 'google') => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  signedIn: false,
  displayName: null,
  provider: null,
  signIn: (provider) => set({ signedIn: true, provider, displayName: '팩토 사용자' }),
  signOut: () => set({ signedIn: false, provider: null, displayName: null }),
}));
