import { create } from 'zustand';

import type { AuthUser } from '@/features/auth/authService';

/**
 * 현재 로그인 상태. 값은 authService.onChange가 채운다 (src/app/_layout.tsx).
 * 화면은 여기서 상태만 읽고, 로그인/로그아웃은 authService를 호출한다.
 */
interface SessionState {
  status: 'loading' | 'signedIn' | 'signedOut';
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  setUser: (user) => set({ user, status: user ? 'signedIn' : 'signedOut' }),
}));
