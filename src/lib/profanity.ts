// Lightweight profanity filter for user comments. Deliberately small —
// catches the common cases and obvious variants without pretending to be a
// moderation system (report + admin delete are the real tools).

const BLOCKED = [
  // english
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'dick ',
  'asshole',
  // finnish
  'vitun',
  'vittu',
  'perkele',
  'saatana',
  'helvetti',
  'paska',
  'huora',
  // swedish
  'fan ',
  'jävlar',
  'helvete',
];

/** True when the text contains a blocked term (with leetspeak/spacing normalization). */
export function containsProfanity(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[*_.-]{1,3}/g, ' ');
  return BLOCKED.some((word) => normalized.includes(word.trim()));
}

/** Replace blocked terms with ♥♥♥ (keeps the comment readable, censored). */
export function maskProfanity(text: string): string {
  let masked = text;
  for (const word of BLOCKED) {
    const w = word.trim();
    if (!w) continue;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    masked = masked.replace(re, '♥'.repeat(Math.min(w.length, 6)));
  }
  return masked;
}
