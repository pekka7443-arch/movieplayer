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
  logger[level](fields, 'request');
}

/** Child logger bound to a request id — use inside route handlers. */
export function requestLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}
