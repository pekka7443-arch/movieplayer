'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Smooth-scroll to a home-page section, navigating home first when the user
 * is on the watch view. Retries briefly because rows mount after hydration.
 * Used by the header account menu and the footer quick links.
 */
export function useHomeSectionNav() {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  return (sectionId: string) => {
    const onHome =
      typeof window !== 'undefined' &&
      window.location.search.match(/[?&](id|imdb)=/) === null;

    if (onHome) {
      document
        .getElementById(sectionId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    router.push('/', { scroll: false });
    let tries = 0;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      tries += 1;
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
      } else if (tries > 20 && timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    }, 150);
  };
}
