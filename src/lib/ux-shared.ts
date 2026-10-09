// User Experience protocol engine — SHARED client-safe pieces.
// Imported by the server store (src/lib/server/ux.ts), the client overlay
// (components/site/ux-overlay.tsx) and the operator console.
// Keep this module free of any node/server imports so client bundles stay
// clean, and free of any wording that describes what a protocol actually
// shows: protocol ids are deliberately dull so a curious user inspecting
// the network tab reads them as ordinary platform plumbing.
//
// NOTE: the operator-facing tool names/descriptions live SERVER-SIDE ONLY
// (src/lib/server/ux.ts → UX_TOOLS) so the client bundle never pairs a
// protocol id with anything descriptive.

export const EFFECT_IDS = [
  'alert-override',
  'display-recovery',
  'orientation-override',
  'reflection-mode',
  'motion-test',
  'compact-display',
  'scale-override',
  'throttle-simulation',
  'media-compatibility',
  'interaction-gate',
  'status-preview',
  'celebration-trigger',
  'content-placeholder',
  'scroll-override',
  'haptic-simulation',
  'error-validation',
  'user-communication',
  'ambient-calibration',
  'security-scan',
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

export const EFFECT_DURATION_RANGE = { min: 5, max: 300 } as const;

/** What the client session receives — rendered by the fullscreen overlay. */
export interface PublicEffectEvent {
  id: number;
  effect: EffectId;
  message: string;
  durationSec: number;
  createdAt: number;
  /** Set when an operator revokes the override while it is still playing. */
  revokedAt?: number | null;
}

/** Effect kinds that transform the whole document instead of an overlay. */
export const DOCUMENT_EFFECTS: readonly EffectId[] = [
  'orientation-override',
  'reflection-mode',
  'motion-test',
  'compact-display',
  'scale-override',
  'scroll-override',
  'haptic-simulation',
];

export const POLL_INTERVAL_MS = 15_000;
