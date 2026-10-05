'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has come near the viewport (rootMargin 300px).
 * Fires at most once — used to defer heavy below-fold subtrees (poster rows)
 * until they are about to be seen, so the initial hydration only pays for
 * above-the-fold content. Skeletons of the same size keep layout stable.
 */
export function useNearViewport<T extends HTMLElement>(enabled = true): {
  ref: React.RefObject<T | null>;
  near: boolean;
} {
  const ref = useRef<T | null>(null);
  // No IntersectionObserver (ancient browsers / non-DOM) → everything is near.
  const [near, setNear] = useState(
    () => !enabled || typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near]);

  return { ref, near };
}
