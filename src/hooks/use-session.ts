'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMe, type AuthUser } from '@/lib/auth-client';

/**
 * Current CineDeck account (or null when browsing as a guest).
 * Invalidate via queryClient.invalidateQueries({ queryKey: ['session'] })
 * after login / register / logout.
 */
export function useSession(): { user: AuthUser | null; loading: boolean } {
  const query = useQuery<AuthUser | null>({
    queryKey: ['session'],
    queryFn: fetchMe,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return { user: query.data ?? null, loading: query.isPending };
}

/** Invalidate every cache that depends on the account identity. */
export function invalidateIdentityCaches(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['session'] });
  void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  void queryClient.invalidateQueries({ queryKey: ['history'] });
}
