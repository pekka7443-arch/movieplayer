// Email adapter — pluggable provider interface.
//
//  - SMTP_URL unset (default): console adapter — every message is logged to
//    the server log (visible in dev.log / the admin Logs panel).
//  - SMTP_URL set (smtp[s]://user:pass@host:port): a real nodemailer SMTP
//    transport is created lazily on first use and cached. Used for password
//    resets, verification emails and admin security alerts.
//
// Transport creation is lazy + fault-tolerant: a bad SMTP_URL degrades to
// console logging (with a loud error) instead of taking a route down.

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

function htmlBody(email: OutgoingEmail): string {
  const action =
    email.actionUrl ?
      `<p style="margin:24px 0"><a href="${email.actionUrl}" style="background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-family:sans-serif">Open CineDeck</a></p>
       <p style="font-family:sans-serif;font-size:12px;color:#888">Or copy this link: ${email.actionUrl}</p>`
    : '';
  return (
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#222">` +
    `<p>${email.text.replace(/\n/g, '<br />')}</p>${action}` +
    `<p style="font-size:11px;color:#aaa">CineDeck — stream everything.</p></div>`
  );
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

type NodemailerTransport = {
  sendMail(options: { from?: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
};

const globalForMailer = globalThis as unknown as {
  __cinedeckMailer?: Mailer;
  __cinedeckSmtpTransport?: NodemailerTransport | null;
};

/** Lazily build (and cache) the SMTP transport from SMTP_URL. */
async function smtpTransport(): Promise<NodemailerTransport | null> {
  if (globalForMailer.__cinedeckSmtpTransport !== undefined) {
    return globalForMailer.__cinedeckSmtpTransport;
  }
  globalForMailer.__cinedeckSmtpTransport = null; // default: unavailable
  try {
    // Dynamic require keeps nodemailer out of any bundling path (it is also
    // listed in next.config serverExternalPackages).
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native-ish package, must stay external
    const nodemailer = require('nodemailer') as {
      createTransport(url: string, options?: Record<string, unknown>): NodemailerTransport;
    };
    const url = process.env.SMTP_URL ?? '';
    if (!url) return null;
    globalForMailer.__cinedeckSmtpTransport = nodemailer.createTransport(url, {
      // Sensible defaults; SMTP_URL may override via query params.
      connectionTimeout: 10_000,
    });
    logger.info('email (SMTP adapter) — SMTP_URL configured');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? { message: error.message } : error },
      'email: SMTP_URL is set but the transport could not be created — falling back to console logging',
    );
  }
  return globalForMailer.__cinedeckSmtpTransport;
}

function smtpMailer(): Mailer {
  return {
    async send(email) {
      const transport = await smtpTransport();
      if (!transport) {
        // Bad/missing transport — degrade loudly, never silently drop.
        logger.warn(
          { to: email.to, subject: email.subject },
          'email NOT delivered (SMTP unavailable) — configure SMTP_URL correctly',
        );
        return;
      }
      try {
        await transport.sendMail({
          from: process.env.MAIL_FROM ?? 'CineDeck <no-reply@cinedeck.local>',
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: htmlBody(email),
        });
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? { message: error.message } : error, to: email.to },
          'email: SMTP send failed',
        );
        throw error; // callers decide whether failures are fatal
      }
    },
  };
}

export function mailer(): Mailer {
  if (process.env.SMTP_URL) {
    globalForMailer.__cinedeckMailer ??= smtpMailer();
    return globalForMailer.__cinedeckMailer;
  }
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
