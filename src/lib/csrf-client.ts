'use client';

// CSRF double-submit client (2026-11-03 hardening).
//
// Installs a transparent window.fetch wrapper that appends the
// `x-csrf-token` header (echoing the `cinedeck_csrf` cookie set by the
// middleware) to every SAME-ORIGIN mutating request (POST/PUT/PATCH/DELETE).
// The server (src/lib/server/http.ts) rejects mutating requests whose csrf
// cookie is present but whose header does not match — cross-site attackers
// can neither read the cookie nor set custom headers.
//
// Fail-safe by construction: any parsing problem → the original fetch runs
// untouched (the server still applies the origin check as the outer gate).

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_COOKIE = 'cinedeck_csrf';
const CSRF_HEADER = 'x-csrf-token';

declare global {
  interface Window {
    __cinedeckCsrfInstalled?: boolean;
  }
}

export function installCsrfHeader(): void {
  if (typeof window === 'undefined' || window.__cinedeckCsrfInstalled) return;
  window.__cinedeckCsrfInstalled = true;

  const original = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const method = (
        init?.method ??
        (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      )?.toUpperCase();
      if (!method || !MUTATING.has(method)) return original(input, init);

      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const target = new URL(url, window.location.href);
      if (target.origin !== window.location.origin) {
        return original(input, init); // cross-origin — not ours to stamp
      }

      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
      if (!match) return original(input, init); // no csrf cookie yet — server allows

      const token = decodeURIComponent(match[1]);

      // Merge into the outgoing headers without clobbering anything else.
      const headers = new Headers(init?.headers ?? undefined);
      if (!headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, token);

      // Request-object input without init: rebuild it with the header merged
      // (the Request(request, init) constructor clones body/method/URL when
      // init does not override them). A consumed-body request passes through.
      if (typeof input !== 'string' && !(input instanceof URL)) {
        if (input.bodyUsed) return original(input, init);
        return original(new Request(input, { method, headers }));
      }
      return original(input, { ...init, method, headers });
    } catch {
      return original(input, init);
    }
  };
}
