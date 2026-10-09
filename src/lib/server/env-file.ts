// Idempotent .env line management (server-only).
//
// All writes are read-modify-write on the single line keyed by NAME at the
// PROJECT ROOT (see project-root.ts — never the build-output cwd). Existing
// unrelated lines are preserved byte-for-byte, duplicate `KEY=` lines are
// collapsed to one, and a value that is already correct is NOT rewritten
// (no churn, no spurious mtime changes).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './project-root';

export function envFilePath(): string {
  return path.join(projectRoot(), '.env');
}

/** Read a value from the project .env file (LAST occurrence wins, matching dotenv/bun loader semantics). Returns null when the file or key is missing. */
export function envFileGet(key: string): string | null {
  try {
    const file = envFilePath();
    if (!existsSync(file)) return null;
    const content = readFileSync(file, 'utf8');
    const matches = content.match(new RegExp(`^${key}=(.*)$`, 'gm'));
    if (!matches || matches.length === 0) return null;
    return matches[matches.length - 1].slice(key.length + 1).trim();
  } catch {
    return null;
  }
}

export type UpsertResult = 'created' | 'replaced' | 'unchanged';

/**
 * Set KEY=value in the project .env. Replaces the FIRST existing occurrence
 * in place, drops any duplicate occurrences, or appends a new line when the
 * key is absent. Returns what happened (callers use it for log lines).
 */
export function upsertEnvValue(key: string, value: string): UpsertResult {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`upsertEnvValue: invalid env key ${key}`);
  }
  const file = envFilePath();
  const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const keyRe = new RegExp(`^${key}=(.*)$`);

  const lines = content.split('\n');
  let firstIdx = -1;
  let currentValue: string | null = null;
  let droppedDuplicates = false;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(keyRe);
    if (!match) {
      kept.push(lines[i]);
      continue;
    }
    if (firstIdx === -1) {
      firstIdx = i;
      currentValue = match[1];
      kept.push(lines[i]); // canonical line, possibly replaced below
    } else {
      droppedDuplicates = true; // duplicate occurrence silently dropped
    }
  }

  if (firstIdx === -1) {
    const prefix = content === '' ? '' : content.endsWith('\n') ? content : `${content}\n`;
    writeFileSync(file, `${prefix}${key}=${value}\n`);
    return 'created';
  }

  if (currentValue === value) {
    if (!droppedDuplicates) return 'unchanged';
    writeFileSync(file, kept.join('\n')); // collapse duplicates only
    return 'replaced';
  }

  kept[firstIdx] = `${key}=${value}`;
  writeFileSync(file, kept.join('\n'));
  return 'replaced';
}
