'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => undefined;

/**
 * True only AFTER hydration. Server render and the very first client render
 * both see `false`, so any UI gated on this hook produces identical HTML in
 * both passes — then flips in the same tick hydration completes.
 *
 * Use it to gate UI that depends on client-only state (localStorage session
 * cache, Web Speech support, dismissed flags…) instead of branching directly
 * during the first render, which triggers React hydration mismatches.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
