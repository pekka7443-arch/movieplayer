// Shared admin server helpers: role gate + aggregation utilities.
// The admin route stays a thin composition of these.

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { jsonError } from '@/lib/server/http';
import { classifyUserAgent } from '@/lib/server/geo';

export interface AdminUserContext {
  id: string;
  email: string;
  role: string;
}

/**
 * Role gate for every /api/admin/* surface: 401 for guests, 403 for
 * members without the admin role. Returns the admin's id + email so every
 * audit entry can say WHO did it.
 */
export async function requireAdmin(request: Request): Promise<AdminUserContext | Response> {
  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);
  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { id: true, email: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return jsonError('unauthorized', 401);
  if (user.role !== 'admin') return jsonError('forbidden', 403);
  return { id: user.id, email: user.email, role: user.role };
}

/** Bucket counts for the "top browsers / devices" admin charts. */
export function tallyUserAgents(
  userAgents: (string | null)[],
): { browsers: { name: string; count: number }[]; devices: { name: string; count: number }[] } {
  const browsers = new Map<string, number>();
  const devices = new Map<string, number>();
  for (const ua of userAgents) {
    const info = classifyUserAgent(ua);
    browsers.set(info.browser, (browsers.get(info.browser) ?? 0) + 1);
    devices.set(info.device, (devices.get(info.device) ?? 0) + 1);
  }
  const toSorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  return { browsers: toSorted(browsers), devices: toSorted(devices) };
}

/** Local-noon day bucket helper for the signup series (UTC everywhere). */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** RFC 4180-ish CSV escaping (quotes, commas, newlines). */
export function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function csvBody(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Whitelisted sort columns for the users table (anything else → createdAt). */
export const USER_SORT_COLUMNS = {
  createdAt: 'createdAt',
  email: 'email',
  name: 'name',
  role: 'role',
  lastSeenAt: 'lastSeenAt',
} as const;

export type UserSortColumn = keyof typeof USER_SORT_COLUMNS;

/** Best-effort "last seen" resolution: latest session row per user. */
export async function lastSeenByUser(userIds: string[]): Promise<Map<string, Date | null>> {
  if (userIds.length === 0) return new Map();
  const sessions = await db.session.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  });
  const map = new Map<string, Date | null>();
  for (const id of userIds) map.set(id, null);
  for (const s of sessions) {
    if (!map.has(s.userId) || map.get(s.userId) === null) map.set(s.userId, s.lastSeenAt);
  }
  return map;
}
