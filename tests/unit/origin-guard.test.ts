// Unit tests for the same-origin CSRF guard (src/lib/server/http.ts).
// Covers: Sec-Fetch-Site layering (proxy-proof), Host comparison,
// X-Forwarded-Host, ALLOWED_ORIGINS env, platform preview domains,
// Referer fallback and the no-origin allow path.

import { afterEach, describe, expect, it } from 'vitest';

import { isSameOrigin } from '../../src/lib/server/http';

function req(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://internal.test/api/auth/login', {
    method,
    headers,
  });
}

const EXTRA_ENV_KEYS = ['ALLOWED_ORIGINS'] as const;

afterEach(() => {
  for (const key of EXTRA_ENV_KEYS) delete process.env[key];
});

describe('same-origin guard', () => {
  // -- Sec-Fetch-Site (browser-asserted, proxy-proof) -----------------------
  it('allows same-origin fetch even when Host was rewritten by a proxy', () => {
    const r = req('POST', {
      'sec-fetch-site': 'same-origin',
      origin: 'https://preview-abc.space-z.ai',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('rejects cross-site fetch even when hosts would match', () => {
    const r = req('POST', {
      'sec-fetch-site': 'cross-site',
      origin: 'https://localhost:3000',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  it('allows fetch-site none (user-initiated direct navigation)', () => {
    const r = req('POST', { 'sec-fetch-site': 'none', host: 'localhost:3000' });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('same-site falls through to the header comparison', () => {
    const matching = req('POST', {
      'sec-fetch-site': 'same-site',
      origin: 'https://localhost:3000',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(matching)).toBe(true);

    const mismatched = req('POST', {
      'sec-fetch-site': 'same-site',
      origin: 'https://evil.test',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(mismatched)).toBe(false);
  });

  // -- Classic Host comparison ----------------------------------------------
  it('allows matching Origin host == Host header', () => {
    const r = req('POST', {
      origin: 'https://mydeck.example.com',
      host: 'mydeck.example.com',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('ignores scheme/port differences between Origin and Host', () => {
    const r = req('POST', {
      origin: 'http://mydeck.example.com:8443',
      host: 'mydeck.example.com',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('rejects a foreign Origin even with Sec-Fetch-Site absent', () => {
    const r = req('POST', {
      origin: 'https://evil.test',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  it('rejects an unparseable Origin', () => {
    const r = req('POST', { origin: 'not-a-url', host: 'localhost:3000' });
    expect(isSameOrigin(r)).toBe(false);
  });

  // -- Proxy headers + env ---------------------------------------------------
  it('accepts Origin matching X-Forwarded-Host behind a rewriting proxy', () => {
    const r = req('POST', {
      origin: 'https://preview-abc.space-z.ai',
      host: 'internal-21.0.16.174:3000',
      'x-forwarded-host': 'preview-abc.space-z.ai, gateway.local',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('accepts extra hostnames from ALLOWED_ORIGINS', () => {
    process.env.ALLOWED_ORIGINS = 'deck1.example.com, deck2.example.com';
    const r = req('POST', {
      origin: 'https://deck2.example.com',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('does not accept hosts merely CONTAINED in ALLOWED_ORIGINS', () => {
    process.env.ALLOWED_ORIGINS = 'deck.example.com';
    const r = req('POST', {
      origin: 'https://deck.example.com.evil.test',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  it('rejects sibling platform subdomains when Host was rewritten (2026-11-03 hardening)', () => {
    // Sibling *.z.ai / *.space-z.ai tenants are same-site (SameSite=Lax does
    // NOT block their POSTs) but are NOT this deployment — they must fail
    // the header comparison. Only a Sec-Fetch-Site: same-origin assertion
    // (browser-issued) can pass with a rewritten Host.
    for (const origin of [
      'https://preview-abc123.space-z.ai',
      'https://chat.z.ai',
      'https://app.z.ai',
      'https://evil.space-z.ai',
    ]) {
      const r = req('POST', {
        origin,
        host: 'localhost:3000',
      });
      expect(isSameOrigin(r), origin).toBe(false);
    }
  });

  it('accepts an origin that matches the request host (platform gateway preserves Host)', () => {
    const r = req('POST', {
      origin: 'https://movieplayer222.space-z.ai',
      host: 'movieplayer222.space-z.ai',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('does not trust look-alike platform domains', () => {
    const r = req('POST', {
      origin: 'https://evil.space-z.ai.test',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  // -- Referer fallback + no-origin paths ------------------------------------
  it('falls back to Referer when it matches the request host', () => {
    const r = req('POST', {
      referer: 'https://movieplayer222.space-z.ai/login',
      host: 'movieplayer222.space-z.ai',
    });
    expect(isSameOrigin(r)).toBe(true);
  });

  it('rejects a sibling-subdomain Referer when the hosts do not match', () => {
    const r = req('POST', {
      referer: 'https://preview-abc.space-z.ai/login',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  it('rejects a foreign Referer when Origin is absent', () => {
    const r = req('POST', {
      referer: 'https://evil.test/login',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(false);
  });

  it('allows requests with neither Origin nor Referer (curl, s2s)', () => {
    expect(isSameOrigin(req('POST', { host: 'localhost:3000' }))).toBe(true);
    expect(isSameOrigin(req('POST'))).toBe(true);
  });

  it('never guards non-mutating methods', () => {
    const r = req('GET', {
      origin: 'https://evil.test',
      host: 'localhost:3000',
    });
    expect(isSameOrigin(r)).toBe(true);
  });
});
