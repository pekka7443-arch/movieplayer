'use client';

import { useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import { ArrowUp } from 'lucide-react';

/** Brand gradient hairline that tracks page scroll progress. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 130,
    damping: 26,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-gradient-to-r from-brand via-brand/70 to-brand/25"
      style={{ scaleX }}
    />
  );
}

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Floating back-to-top button with a live scroll-progress ring.
 * Appears after ~600px of scroll; springs in/out via AnimatePresence.
 */
export function BackToTop() {
  const { scrollY, scrollYProgress } = useScroll();
  const [visible, setVisible] = useState(false);

  // Event-callback state update (not effect-body) — lint-safe pattern.
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setVisible(latest > 600);
  });

  const dashOffset = useTransform(
    scrollYProgress,
    [0, 1],
    [RING_CIRCUMFERENCE, RING_CIRCUMFERENCE * 0.0001],
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          initial={{ opacity: 0, scale: 0.6, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 16 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className="fixed bottom-5 right-5 z-40 flex size-11 items-center justify-center rounded-full bg-zinc-950/70 text-zinc-100 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-zinc-900/80 dark:bg-zinc-100/10 dark:text-zinc-50 dark:hover:bg-zinc-100/15 sm:bottom-6 sm:right-6"
        >
          <svg
            aria-hidden
            viewBox="0 0 48 48"
            className="absolute inset-0 size-full -rotate-90"
            fill="none"
          >
            <motion.circle
              cx="24"
              cy="24"
              r={RING_RADIUS}
              className="stroke-brand/80"
              strokeWidth="2.5"
              strokeDasharray={RING_CIRCUMFERENCE}
              style={{ strokeDashoffset: dashOffset }}
              strokeLinecap="round"
            />
          </svg>
          <ArrowUp className="size-4.5" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
