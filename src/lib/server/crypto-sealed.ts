// AES-256-GCM authenticated encryption for secrets at rest (2026-11-03
// security hardening).
//
// PURPOSE: TOTP secrets (and any future small secrets) are stored in the
// database ENCRYPTED, never plaintext. The key is derived via HKDF-SHA256
// from AUTH_SECRET — which lives ONLY in the runtime environment / project
// .env / the protected volume file, NEVER in the database — so the database
// file alone (backup leak, SQLite file read, SQL exfiltration) can never
// decrypt the sealed values. Key and ciphertext are stored separately by
// construction.
//
// FORMAT: `enc:v1:<iv b64url>:<tag b64url>:<ct b64url>` — versioned so the
// scheme can evolve. AAD binds the version + the record's owner id when
// supplied (a sealed blob copied between rows fails to decrypt).
//
// Server-only. Never import from client components.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { authSecret } from './auth';

const VERSION = 'enc:v1';
const HKDF_SALT = 'cinedeck:seal:v1';
const HKDF_INFO = 'cinedeck:totp-secret-encryption';
const KEY_LEN = 32; // AES-256

/** Derive the 256-bit data-encryption key from AUTH_SECRET (cached per process). */
let cachedKey: Buffer | null = null;
function dataKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(hkdfSync('sha256', authSecret(), HKDF_SALT, HKDF_INFO, KEY_LEN));
  }
  return cachedKey;
}

/** True when a stored value uses the sealed format (vs legacy plaintext). */
export function isSealed(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

/**
 * Encrypt a UTF-8 string. `aad` (additional authenticated data) ties the
 * ciphertext to its context (e.g. the user id) — optional but recommended.
 */
export function sealString(plain: string, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(`${VERSION}:${aad}`, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt a sealed value. Returns null for ANY failure (wrong key, tampered
 * tag, malformed input) — callers treat null as "unusable secret", never as
 * an exception. When `aad` was used to seal, the same value must be passed.
 */
export function openString(sealed: string, aad?: string): string | null {
  try {
    // VERSION itself contains ':' — slice it off before splitting the rest.
    if (!sealed.startsWith(`${VERSION}:`)) return null;
    const rest = sealed.slice(VERSION.length + 1).split(':');
    if (rest.length !== 3) return null;
    const [ivB64, tagB64, ctB64] = rest;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ct = Buffer.from(ctB64, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) return null;
    const decipher = createDecipheriv('aes-256-gcm', dataKey(), iv);
    if (aad !== undefined) decipher.setAAD(Buffer.from(`${VERSION}:${aad}`, 'utf8'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Read a stored secret that may be sealed (new) or legacy plaintext (base32
 * TOTP secrets contain no ':' so the formats are unambiguous). Returns the
 * PLAINTEXT secret, or null when sealed-but-undecryptable / empty.
 */
export function openStoredSecret(stored: string | null | undefined, aad?: string): string | null {
  if (!stored) return null;
  if (isSealed(stored)) return openString(stored, aad);
  return stored; // legacy plaintext — callers re-seal opportunistically
}

/** Test/reset the cached key (unit tests only). */
export function resetSealKeyCacheForTests(): void {
  cachedKey = null;
}
