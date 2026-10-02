'use client';

import { useEffect } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

/**
 * Fixed cinematic atmosphere behind the entire app:
 *  - brand-tinted aurora blobs that drift for a minute+ at a time (CSS keyframes)
 *  - a slow conic light shaft sweeping around once every ~2 minutes
 *  - a static film-grain overlay for texture
 *  - a dark-mode-only vignette for depth
 *  - a subtle pointer spotlight (fine pointers only, motion values — zero re-renders)
 *
 * Purely decorative: pointer-events-none, aria-hidden, -z-10. Everything is
 * transform/opacity based and freezes under prefers-reduced-motion. Accent
 * glows use var(--cinedeck-accent) so they repaint with the user's theme.
 */
export function AmbientBackground() {
  const reduceMotion = useReducedMotion();

  // Pointer spotlight — motion values only, no React state involved.
  const pointerX = useMotionValue(-800);
  const pointerY = useMotionValue(-800);
  const spotX = useSpring(pointerX, { stiffness: 42, damping: 18, mass: 0.7 });
  const spotY = useSpring(pointerY, { stiffness: 42, damping: 18, mass: 0.7 });

  useEffect(() => {
    if (reduceMotion) return;
    // Touch devices get no spotlight (no hover to track).
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      pointerX.set(e.clientX);
      pointerY.set(e.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [pointerX, pointerY, reduceMotion]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base wash — faint accent bloom from the top of the page */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_-5%,color-mix(in_srgb,var(--cinedeck-accent)_8%,transparent),transparent_62%)]" />

      {/* Aurora blobs — one brand-tinted, two cinematic complements */}
      <div className="cd-blob cd-blob-a -top-44 left-[6%] h-[34rem] w-[46rem] bg-[color-mix(in_srgb,var(--cinedeck-accent)_22%,transparent)] opacity-70 dark:opacity-100" />
      <div className="cd-blob cd-blob-b top-[32%] -right-56 h-[36rem] w-[36rem] bg-cyan-400/10 dark:bg-cyan-400/[0.08]" />
      <div className="cd-blob cd-blob-c bottom-[-16rem] left-[26%] h-[30rem] w-[44rem] bg-rose-400/10 dark:bg-rose-500/[0.09]" />

      {/* Slow sweeping light shaft (two mirrored wedges on one disc) */}
      <div className="absolute -top-[85vh] left-1/2 h-[170vh] w-[170vh] -translate-x-1/2 opacity-[0.05] dark:opacity-[0.07]">
        <div
          className="cd-beam size-full rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--cinedeck-accent) 60%, transparent) 12deg, transparent 26deg, transparent 165deg, color-mix(in srgb, var(--cinedeck-accent) 40%, transparent) 180deg, transparent 194deg, transparent 360deg)',
            filter: 'blur(28px)',
          }}
        />
      </div>

      {/* Film grain — static, mix-blend keeps it invisible-invisible but tactile */}
      <div className="cd-grain absolute inset-0 opacity-[0.05] mix-blend-overlay dark:opacity-[0.07]" />

      {/* Vignette — dark mode only, pulls the eye to the content column */}
      <div className="absolute inset-0 hidden bg-[radial-gradient(95%_75%_at_50%_38%,transparent_52%,rgba(0,0,0,0.28)_100%)] dark:block" />

      {/* Pointer spotlight — a soft accent halo that trails the cursor */}
      {!reduceMotion && (
        <motion.div
          className="absolute left-0 top-0 hidden size-[34rem] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--cinedeck-accent)_9%,transparent),transparent_62%)] md:block"
          style={{ x: spotX, y: spotY, marginLeft: '-17rem', marginTop: '-17rem' }}
        />
      )}
    </div>
  );
}
