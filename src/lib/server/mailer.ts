// Email adapter — pluggable provider interface with a console logger as the
// development default. SMTP creds (SMTP_URL) can later be wired to a real
// transport (nodemailer) without touching the call sites: only `sendEmail`
// changes.

import { logger } from './logger';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Absolute URL the recipient should follow. */
  actionUrl?: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}

function consoleMailer(): Mailer {
  return {
    async send(email) {
      logger.info(
        {
          to: email.to,
          subject: email.subject,
          actionUrl: email.actionUrl,
        },
        'email (console adapter) — configure SMTP_URL to deliver for real',
      );
    },
  };
}

const globalForMailer = globalThis as unknown as { __cinedeckMailer?: Mailer };

export function mailer(): Mailer {
  // SMTP support is a deliberate extension point — until SMTP_URL exists the
  // console adapter logs every message (visible in dev.log / server logs).
  globalForMailer.__cinedeckMailer ??= consoleMailer();
  return globalForMailer.__cinedeckMailer;
}

export function appBaseUrl(request?: Request): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (request) {
    const url = new URL(request.url);
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const host = request.headers.get('host') ?? url.host;
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}
