// Structured logging (pino) with request ids.
// pino is JSON-first; in development the output stays pretty-printed lines.

import { randomUUID } from 'node:crypto';
import pino from 'pino';

const globalForLogger = globalThis as unknown as { __cinedeckLogger?: pino.Logger };

export const logger: pino.Logger =
  globalForLogger.__cinedeckLogger ??
  pino({
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    base: { app: 'cinedeck' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.tokenHash',
      ],
      censor: '[redacted]',
    },
  });
globalForLogger.__cinedeckLogger = logger;

export function newRequestId(): string {
  return randomUUID();
}

export interface RequestLogFields {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
}

export function logRequest(fields: RequestLogFields): void {
  const level = fields.status >= 500 ? 'error' : fields.status >= 400 ? 'warn' : 'info';
  pushRecentLog({
    time: new Date().toISOString(),
    level,
    msg: 'request',
    path: fields.path,
    status: fields.status,
    durationMs: fields.durationMs,
    requestId: fields.requestId,
  });
  logger[level](fields, 'request');
}

/** Child logger bound to a request id — use inside route handlers. */
export function requestLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}

// ---------------------------------------------------------------------------
// In-memory recent-log ring — powers the admin Logs panel (dev + prod).
// Keeps the last 200 entries (requests + errors) in this process.
// ---------------------------------------------------------------------------

export interface RecentLogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  path?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
}

const globalForLogRing = globalThis as unknown as { __cinedeckLogRing?: RecentLogEntry[] };
const RING_SIZE = 200;

function ring(): RecentLogEntry[] {
  if (!globalForLogRing.__cinedeckLogRing) globalForLogRing.__cinedeckLogRing = [];
  return globalForLogRing.__cinedeckLogRing;
}

export function pushRecentLog(entry: RecentLogEntry): void {
  const buf = ring();
  buf.push(entry);
  if (buf.length > RING_SIZE) buf.splice(0, buf.length - RING_SIZE);
}

/** Newest-last list of the most recent `take` entries. */
export function recentLogs(take = 100): RecentLogEntry[] {
  return ring().slice(-take);
}

export function clearRecentLogs(): void {
  globalForLogRing.__cinedeckLogRing = [];
}
