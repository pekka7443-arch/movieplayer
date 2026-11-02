'use client';

// Client-side bootstrap for the CSRF double-submit fetch interceptor.
//
// Rendering <CsrfInstall /> mounts nothing visible — importing this module
// EXECUTES installCsrfHeader() in the browser at bundle load (before any
// component code runs), wrapping window.fetch so every same-origin mutating
// request carries the x-csrf-token header. See src/lib/csrf-client.ts and
// src/lib/server/http.ts for the server half.

import { installCsrfHeader } from '@/lib/csrf-client';

installCsrfHeader();

export function CsrfInstall() {
  return null;
}
