'use client';

// MotionButton — shadcn Button wrapped in a framer-motion micro-interaction
// shell (hover 1.02, tap 0.97). Used for the primary CTAs (Play, My List,
// Follow) so every main action has the same tactile feel. Transforms
// collapse to nothing under prefers-reduced-motion.

import { motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface MotionButtonProps extends ComponentProps<typeof Button> {
  /** Override the default hover affordance (e.g. hero CTAs use 1.04). */
  whileHover?: TargetAndTransition;
  whileTap?: TargetAndTransition;
  children: ReactNode;
}

export function MotionButton({
  whileHover,
  whileTap,
  children,
  className,
  ...props
}: MotionButtonProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="inline-flex"
      whileHover={reduceMotion ? undefined : (whileHover ?? { scale: 1.02 })}
      whileTap={reduceMotion ? undefined : (whileTap ?? { scale: 0.97 })}
      transition={{ duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
    >
      <Button className={className} {...props}>
        {children}
      </Button>
    </motion.div>
  );
}
