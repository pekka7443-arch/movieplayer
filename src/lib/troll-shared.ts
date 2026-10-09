// Troll engine — SHARED client-safe pieces (types, catalog, labels).
// Imported by the server store (src/lib/server/troll.ts), the fullscreen
// overlay and the admin User Experience tab. Keep this module free of any
// node/server imports so client bundles stay clean.
//
// NOTE: the admin-facing "professional" tool names live SERVER-SIDE ONLY
// (src/lib/server/troll.ts → UX_TOOLS) so the bundle never pairs effect
// types with playful wording. The overlay catalog below is only rendered
// inside prank overlays themselves.

export const TROLL_TYPES = [
  'jumpscare',
  'bluescreen',
  'flip',
  'buffering',
  'disco',
  'ban',
  'virus',
  'confetti',
  'mirror',
  'drunk',
  'tiny',
  'giant',
  'rickroll',
  'doink',
  'cats',
  'scrollreverse',
  'shake',
  'error',
  'message',
] as const;

export type TrollType = (typeof TROLL_TYPES)[number];

export const TROLL_DURATION_RANGE = { min: 5, max: 300 } as const;

/** What the victim sees — shown by the fullscreen overlay. */
export interface PublicTrollEvent {
  id: number;
  type: TrollType;
  message: string;
  durationSec: number;
  createdAt: number;
  /** Set when an admin revokes the override while it is still playing. */
  revokedAt?: number | null;
}

/** Effect kinds that transform the whole document instead of an overlay. */
export const DOCUMENT_EFFECTS: readonly TrollType[] = [
  'flip',
  'mirror',
  'drunk',
  'tiny',
  'giant',
  'scrollreverse',
  'shake',
];

export const TROLL_CATALOG: Record<TrollType, { name: string }> = {
  jumpscare: { name: 'Jumpscare' },
  bluescreen: { name: 'Fake crash' },
  flip: { name: 'Upside-down' },
  buffering: { name: 'Eternal buffering' },
  disco: { name: 'Party mode' },
  ban: { name: 'Fake ban' },
  virus: { name: 'Virus alert' },
  confetti: { name: 'Confetti' },
  mirror: { name: 'Mirror world' },
  drunk: { name: 'Drunk mode' },
  tiny: { name: 'Tiny mode' },
  giant: { name: 'Giant mode' },
  rickroll: { name: 'Rickroll' },
  doink: { name: 'Admin doink' },
  cats: { name: 'Everything is a cat' },
  scrollreverse: { name: 'Reversed scroll' },
  shake: { name: 'Screen shake' },
  error: { name: 'Fake error' },
  message: { name: 'Custom message' },
};

export const TROLL_POLL_INTERVAL_MS = 15_000;
