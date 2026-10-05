'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMe, readCachedUser, type AuthUser } from '@/lib/auth-client';

/**
 * Current CineDeck account (or null when browsing as a guest).
 * Invalidate via queryClient.invalidateQueries({ queryKey: ['session'] })
 * after login / register / logout.
 *
 * Reliability contract:
 *  - the last successfully fetched user is cached in localStorage and used
 *    as initialData, so a page reload paints instantly and a reload while
 *    the network/API is down still shows the signed-in UI;
 *  - fetchMe THROWS on network/5xx and the query retries twice — a flaky
 *    response is never cached as "logged out";
 *  - every page load still refetches (`refetchOnMount: 'always'`), so a
 *    real 200-with-null (session revoked, account deleted) cleanly signs
 *    the UI out.
 */
export function useSession(): { user: AuthUser | null; loading: boolean } {
  const query = useQuery<AuthUser | null>({
    queryKey: ['session'],
    queryFn: fetchMe,
    initialData: readCachedUser,
    refetchOnMount: 'always',
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
    refetchOnWindowFocus: false,
  });
  return { user: query.data ?? null, loading: query.isPending && query.data === undefined };
}

/** Invalidate every cache that depends on the account identity. */
export function invalidateIdentityCaches(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['session'] });
  void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  void queryClient.invalidateQueries({ queryKey: ['history'] });
  void queryClient.invalidateQueries({ queryKey: ['ratings'] });
  void queryClient.invalidateQueries({ queryKey: ['lists'] });
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
}
