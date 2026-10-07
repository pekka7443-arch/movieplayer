// Password strength — shared by the client (live meter) and the server
// (hard gate on register / password change). Pure functions, no DOM.

export interface PasswordVerdict {
  /** Server-enforced floor: register/reset reject weak passwords. */
  acceptable: boolean;
  /** 0–4 for UI metering. */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'too weak' | 'weak' | 'fair' | 'good' | 'strong';
  /** Human hints — shown under the field. */
  problems: string[];
}

const COMMON_FRAGMENTS = [
  'password',
  'passwort',
  'salasana',
  'contrasena',
  'qwerty',
  'azerty',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'dragon',
  'monkey',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'starwars',
  'whatever',
  'trustno1',
  'cinedeck',
  '123456',
  'abcdef',
  'asdfgh',
  'qweqwe',
];

/**
 * Policy (server-enforced floor + client meter): ≥ 8 chars with at least
 * one LETTER, one NUMBER and one SPECIAL character. Common fragments,
 * all-same-character strings and highly repetitive values are rejected.
 */
export function checkPassword(password: string): PasswordVerdict {
  const problems: string[] = [];
  const value = password ?? '';

  const letters = /[a-z]/.test(value);
  const upper = /[A-Z]/.test(value);
  const digits = /\d/.test(value);
  const symbols = /[^a-zA-Z0-9]/.test(value);
  const classes = [letters, upper, digits, symbols].filter(Boolean).length;
  const distinct = new Set(value).size;

  if (value.length < 8) problems.push('Use at least 8 characters.');
  if (value.length >= 8 && !letters) problems.push('Add at least one letter.');
  if (value.length >= 8 && !digits) problems.push('Add at least one number.');
  if (value.length >= 8 && !symbols) problems.push('Add at least one special character (e.g. ! ? %).');
  const lower = value.toLowerCase();
  const fragment = COMMON_FRAGMENTS.find((f) => lower.includes(f));
  if (fragment) problems.push(`Too predictable — avoid words like “${fragment}”.`);
  if (value.length >= 8 && distinct < Math.min(5, Math.ceil(value.length / 3))) {
    problems.push('Too repetitive.');
  }
  if (/^(.)\1+$/.test(value) && value.length > 0) problems.push('All-same characters are not allowed.');

  // Scoring for the UI meter.
  let score: PasswordVerdict['score'] = 0;
  if (value.length >= 8) score = 1;
  if (value.length >= 10 && classes >= 3) score = 2;
  if (value.length >= 12 && classes >= 3) score = 3;
  if (value.length >= 14 && classes >= 4 && distinct >= 8) score = 4;
  if (problems.length > 0 && score > 1) score = 1;

  const labels: PasswordVerdict['label'][] = ['too weak', 'weak', 'fair', 'good', 'strong'];
  return {
    acceptable: value.length >= 8 && problems.length === 0,
    score,
    label: labels[score],
    problems,
  };
}
