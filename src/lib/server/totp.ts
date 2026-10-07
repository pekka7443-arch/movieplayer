// RFC 6238 TOTP (30s step, SHA-1, 6 digits — the default every authenticator
// app uses) built on node:crypto, plus Base32 encode/decode for the secret.
// No external dependency needed.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new TOTP secret (160-bit → 32 base32 chars, as apps expect). */
export function generateTotpSecret(accountLabel: string, issuer = 'CineDeck'): {
  secret: string;
  otpauthUrl: string;
} {
  const secret = base32Encode(randomBytes(20));
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauthUrl };
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Current TOTP for a base32 secret (used in tests and self-check). */
export function currentTotp(secretBase32: string, atMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / 30));
}

/**
 * Verify a user-entered code with ±1 step of clock drift (±30s).
 * Constant-time comparison against each candidate window.
 */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now()): boolean {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const key = base32Decode(secretBase32);
  if (key.length === 0) return false;
  const step = Math.floor(atMs / 1000 / 30);
  const expected = Buffer.from(hotp(key, step));
  const provided = Buffer.from(clean);
  // Check current step first; drift windows use plain compare (also 6 chars).
  if (expected.length === provided.length && timingSafeEqual(expected, provided)) return true;
  for (const delta of [-1, 1]) {
    if (hotp(key, step + delta) === clean) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2FA backup codes — 10 one-time codes, stored as SHA-256 hashes. Each code
// can be used once in place of a live authenticator value (lost phone).
// ---------------------------------------------------------------------------

const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 lookalikes

/** Generate human-typable one-time codes in the form XXXX-XXXX. */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let half = '';
    for (let j = 0; j < 4; j += 1) half += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    let second = '';
    for (let j = 0; j < 4; j += 1) second += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.push(`${half}-${second}`);
  }
  return codes;
}

/** JSON array of SHA-256 hex hashes — the only thing persisted. */
export function hashBackupCodes(codes: string[]): string {
  return JSON.stringify(codes.map((code) => createHash('sha256').update(code.toUpperCase()).digest('hex')));
}

export interface BackupCodeMatch {
  matched: boolean;
  /** Hashes still unused after the check (null when nothing was stored). */
  remaining: string[] | null;
}

/**
 * Constant-time-ish check of a candidate code against the stored hash list.
 * Returns the remaining (unused) hashes so the caller can persist them —
 * every successful match removes the code permanently.
 */
export function matchBackupCode(storedJson: string | null, code: string): BackupCodeMatch {
  if (!storedJson) return { matched: false, remaining: null };
  let hashes: string[];
  try {
    const parsed: unknown = JSON.parse(storedJson);
    if (!Array.isArray(parsed) || parsed.some((h) => typeof h !== 'string')) return { matched: false, remaining: null };
    hashes = parsed as string[];
  } catch {
    return { matched: false, remaining: null };
  }
  const candidate = createHash('sha256').update(code.trim().toUpperCase()).digest();
  let matchedIndex = -1;
  for (let i = 0; i < hashes.length; i += 1) {
    const stored = Buffer.from(hashes[i], 'hex');
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex === -1) return { matched: false, remaining: hashes };
  const remaining = hashes.filter((_, i) => i !== matchedIndex);
  return { matched: true, remaining };
}
