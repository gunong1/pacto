import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { profileStore } from "@/data";
import type { ProfileChanges } from "@/data/profile";

export const profileKeys = { all: ["profile"] as const };

export function useProfile() {
  // Signed URL은 1시간 — 그 전에 새로 받는다
  return useQuery({
    queryKey: profileKeys.all,
    queryFn: () => profileStore.get(),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: ProfileChanges) => profileStore.save(changes),
    onSuccess: (r) => qc.setQueryData(profileKeys.all, r.profile),
  });
}
