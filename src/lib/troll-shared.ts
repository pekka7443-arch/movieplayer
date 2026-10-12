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

export const TROLL_CATALOG: Record<TrollType, { name: string; emoji: string; blurb: string }> = {
  jumpscare: { name: 'Jumpscare', emoji: '😱', blurb: 'A harmless face pops up for a heartbeat.' },
  bluescreen: { name: 'Fake crash', emoji: '🖥️', blurb: 'A very convincing fake system crash.' },
  flip: { name: 'Upside-down', emoji: '🙃', blurb: 'The whole site rotates 180 degrees.' },
  buffering: { name: 'Eternal buffering', emoji: '⏳', blurb: 'The spinner that never ends. Patience test.' },
  disco: { name: 'Party mode', emoji: '🪩', blurb: 'Strobing rainbow background rave.' },
  ban: { name: 'Fake ban', emoji: '🚫', blurb: 'A fake "you are banned" scare. Purely cosmetic.' },
  virus: { name: 'Virus alert', emoji: '🦠', blurb: 'Retro antivirus popup from 2004.' },
  confetti: { name: 'Confetti', emoji: '🎉', blurb: 'Confetti cannon everywhere. Pure joy.' },
  mirror: { name: 'Mirror world', emoji: '🪞', blurb: 'The layout flips horizontally.' },
  drunk: { name: 'Drunk mode', emoji: '🍺', blurb: 'Everything wobbles ever so slightly.' },
  tiny: { name: 'Tiny mode', emoji: '🐜', blurb: 'The entire UI shrinks to ant size.' },
  giant: { name: 'Giant mode', emoji: '🦣', blurb: 'Everything grows way too big.' },
  rickroll: { name: 'Rickroll', emoji: '🎤', blurb: 'Never gonna give you up. Classic.' },
  doink: { name: 'Admin doink', emoji: '🔔', blurb: 'A big friendly DOINK sound. That is it.' },
  cats: { name: 'Everything is a cat', emoji: '🐈', blurb: 'Every image becomes a cat. Obviously.' },
  scrollreverse: { name: 'Reversed scroll', emoji: '🖲️', blurb: 'Scrolling goes the other way.' },
  shake: { name: 'Screen shake', emoji: '🌍', blurb: 'A small earthquake hits the viewport.' },
  error: { name: 'Fake error', emoji: '💥', blurb: 'A scary-looking fake error dialog.' },
  message: { name: 'Custom message', emoji: '💬', blurb: 'Show your own message to viewers.' },
};

export const TROLL_POLL_INTERVAL_MS = 15_000;
