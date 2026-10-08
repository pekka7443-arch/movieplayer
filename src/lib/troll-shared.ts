// Troll engine — SHARED client-safe pieces (types, catalog, labels).
// Imported by the server store (src/lib/server/troll.ts), the fullscreen
// overlay and the admin Troll tab. Keep this module free of any
// node/server imports so client bundles stay clean.

export const TROLL_TYPES = [
  'jumpscare',
  'bluescreen',
  'flip',
  'buffering',
  'disco',
  'ban',
  'virus',
  'confetti',
] as const;

export type TrollType = (typeof TROLL_TYPES)[number];

export const TROLL_DURATION_RANGE = { min: 4, max: 30 } as const;

/** What the victim sees — shown by the fullscreen overlay. */
export interface PublicTrollEvent {
  id: number;
  type: TrollType;
  message: string;
  durationSec: number;
  createdAt: number;
}

export const TROLL_CATALOG: Record<
  TrollType,
  { name: string; emoji: string; blurb: string }
> = {
  jumpscare: {
    name: 'Jumpscare',
    emoji: '😱',
    blurb: 'Fullscreen horror face + scream. The classic. Give them a second to recover.',
  },
  bluescreen: {
    name: 'Fake crash',
    emoji: '💻',
    blurb: 'Convincing system crash screen… that ends with the punchline.',
  },
  flip: {
    name: 'Upside-down',
    emoji: '🙃',
    blurb: 'Rotates their whole page 180° for a while. Australia mode.',
  },
  buffering: {
    name: 'Eternal buffering',
    emoji: '⏳',
    blurb: 'The spinner of doom at 3% forever. Movie night ruined (briefly).',
  },
  disco: {
    name: 'Party mode',
    emoji: '🪩',
    blurb: 'Rainbow disco takeover. Less evil, more fabulous.',
  },
  ban: {
    name: 'Fake ban',
    emoji: '🔨',
    blurb: 'Scary suspension notice with a ridiculous reason — reveals the joke after 5s.',
  },
  virus: {
    name: 'Virus alert',
    emoji: '🦠',
    blurb: 'Retro popup: 47 viruses found. It is downloading MORE viruses.',
  },
  confetti: {
    name: 'Confetti',
    emoji: '🎉',
    blurb: 'Wholesome option: emoji confetti rain. For when they finish a season.',
  },
};

export const TROLL_POLL_INTERVAL_MS = 15_000;
