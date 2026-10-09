// Project-root resolution that works from ANY runtime cwd.
//
// WHY THIS EXISTS: the production server (`.next/standalone/server.js`) is
// started by the platform with cwd = .next/standalone — a directory that is
// DELETED and recreated on every `bun run build`. Any code that resolves
// files via `process.cwd()` (reading/writing .env, config fallbacks) ends up
// pointing inside a disposable build artifact dir. That was the root cause of
// AUTH_SECRET churning across redeploys (see worklog Task 44).
//
// Resolution order (first match wins — a match must contain
// prisma/schema.prisma, which only exists at the project root):
//   1. CINEDECK_ROOT env var (set explicitly by deploy/start scripts)
//   2. Walk up from cwd (covers dev server, CLI scripts, and
//      <root>/.next/standalone — two levels up)
//   3. cwd/../.. (covers the deleted-cwd edge case where the path string is
//      still <root>/.next/standalone but the dir was replaced by a rebuild)
//   4. Fallback: cwd (previous behavior — better than crashing)
//
// Server-only. Result is cached per process.

import { existsSync } from 'node:fs';
import path from 'node:path';

const globalForRoot = globalThis as unknown as { __cinedeckProjectRoot?: string };

function looksLikeRoot(dir: string): boolean {
  return existsSync(path.join(dir, 'prisma', 'schema.prisma'));
}

export function projectRoot(): string {
  const cached = globalForRoot.__cinedeckProjectRoot;
  if (cached) return cached;

  const candidates: string[] = [];

  // 1. Explicit override — the deploy/start scripts export this.
  const envRoot = process.env.CINEDECK_ROOT;
  if (envRoot) candidates.push(path.resolve(envRoot));

  // 2. Walk up from cwd (max 6 levels — deeper nesting is never ours).
  try {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      candidates.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* cwd unreadable (deleted dir edge case) — skip the walk */
  }

  // 3. Standalone layout: <root>/.next/standalone → grandparent.
  candidates.push(path.resolve(process.cwd(), '..', '..'));

  for (const candidate of candidates) {
    if (candidate && looksLikeRoot(candidate)) {
      globalForRoot.__cinedeckProjectRoot = candidate;
      return candidate;
    }
  }

  // 4. Last resort — matches the pre-fix behavior.
  globalForRoot.__cinedeckProjectRoot = process.cwd();
  return globalForRoot.__cinedeckProjectRoot;
}
