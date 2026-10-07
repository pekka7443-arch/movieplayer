import { z } from 'zod';

import { db } from '@/lib/db';
import { apiError, withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';
import { recentLogs } from '@/lib/server/logger';
import { writeAudit } from '@/lib/server/audit';
import { signStatelessToken } from '@/lib/server/auth';
import { appBaseUrl, mailer } from '@/lib/server/mailer';
import {
  lastSeenByUser,
  requireAdmin,
  tallyUserAgents,
  USER_SORT_COLUMNS,
  csvBody,
  type UserSortColumn,
} from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

const isResponse = (value: unknown): value is Response => value instanceof Response;

// ---------------------------------------------------------------------------
// GET /api/admin — dashboard data. Admin role required (401 guests, 403
// members). Views: overview (default) | users | user | audit | sessions |
// reports. ?logs=1 keeps the in-memory log ring for the Logs panel.
// ---------------------------------------------------------------------------
export const GET = withApi('admin', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const url = new URL(request.url);
  const params = url.searchParams;

  if (params.get('logs')) {
    return Response.json({ logs: recentLogs(100) });
  }

  const view = params.get('view') ?? 'overview';

  if (view === 'users') return usersView(params, admin.email);
  if (view === 'user') return userDetailView(params);
  if (view === 'audit') return auditView(params);
  if (view === 'sessions') return sessionsView(params);
  if (view === 'reports') return reportsView();
  return overviewView();
});

// ---------------------------------------------------------------------------
// OVERVIEW — cards, chart series, recent signups, failed logins, providers.
// ---------------------------------------------------------------------------
async function overviewView() {
  const now = Date.now();
  const d24 = new Date(now - 24 * 60 * 60 * 1000);
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const [
    totalUsers,
    newToday,
    newWeek,
    active24h,
    active7d,
    active30d,
    suspended,
    deleted,
    verified,
    twofa,
    sessionCount,
    commentCount,
    flaggedComments,
    watchlistCount,
    historyCount,
    recentUsers,
    providerStats,
    failedLogins,
    announcements,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.user.count({ where: { createdAt: { gte: d7 } } }),
    db.session.findMany({ where: { lastSeenAt: { gte: d24 } }, select: { userId: true }, distinct: ['userId'] }),
    db.session.findMany({ where: { lastSeenAt: { gte: d7 } }, select: { userId: true }, distinct: ['userId'] }),
    db.session.findMany({ where: { lastSeenAt: { gte: d30 } }, select: { userId: true }, distinct: ['userId'] }),
    db.user.count({ where: { suspendedAt: { not: null } } }),
    db.user.count({ where: { deletedAt: { not: null } } }),
    db.user.count({ where: { emailVerified: { not: null } } }),
    db.user.count({ where: { totpEnabled: true } }),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.comment.count({ where: { status: 'visible' } }),
    db.comment.count({ where: { status: 'flagged' } }),
    db.watchlistItem.count(),
    db.watchHistory.count(),
    db.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, email: true, name: true, role: true, createdAt: true, country: true, city: true, avatar: true },
    }),
    db.providerStat.findMany({ orderBy: { id: 'asc' } }),
    db.loginAttempt.findMany({ where: { success: false, createdAt: { gte: d24 } }, select: { ip: true, email: true, reason: true, createdAt: true } }),
    db.announcement.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' } }),
  ]);

  // Signups per day for the last 30 days.
  const signups = await db.user.findMany({
    where: { createdAt: { gte: d30 } },
    select: { createdAt: true },
  });
  const signupSeries = buildDaySeries(signups.map((s) => s.createdAt), 30);

  // Active users per day (DAU series) from session lastSeenAt (30 days).
  const seen = await db.session.findMany({
    where: { lastSeenAt: { gte: d30 } },
    select: { userId: true, lastSeenAt: true },
  });
  const dauByDay = new Map<string, Set<string>>();
  for (const row of seen) {
    const key = row.lastSeenAt.toISOString().slice(0, 10);
    const set = dauByDay.get(key) ?? new Set<string>();
    set.add(row.userId);
    dauByDay.set(key, set);
  }
  const dauSeries = buildDaySeries(
    [...dauByDay.entries()].flatMap(([key, set]) => Array.from({ length: set.size }, () => new Date(`${key}T12:00:00.000Z`))),
    30,
  );

  // Signups by country + top browsers/devices (from sessions' stored UAs).
  const usersForCountry = await db.user.findMany({ select: { country: true } });
  const byCountry = new Map<string, number>();
  for (const u of usersForCountry) {
    const key = u.country ?? 'Unknown';
    byCountry.set(key, (byCountry.get(key) ?? 0) + 1);
  }
  const countries = [...byCountry.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const uaRows = await db.session.findMany({
    where: { lastSeenAt: { gte: d30 } },
    select: { userAgent: true },
    orderBy: { lastSeenAt: 'desc' },
    take: 500,
  });
  const { browsers, devices } = tallyUserAgents(uaRows.map((r) => r.userAgent));

  // Failed logins grouped by (truncated) IP over 24h.
  const byIp = new Map<string, number>();
  for (const attempt of failedLogins) {
    const key = attempt.ip ?? 'unknown';
    byIp.set(key, (byIp.get(key) ?? 0) + 1);
  }
  const failedByIp = [...byIp.entries()]
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top titles by distinct viewers.
  const historyRows = await db.watchHistory.findMany({
    select: { ownerId: true, tmdbId: true, mediaType: true, title: true, posterPath: true },
  });
  const byTitle = new Map<string, { tmdbId: number; mediaType: string; title: string; posterPath: string | null; viewers: Set<string> }>();
  for (const row of historyRows) {
    const key = `${row.tmdbId}:${row.mediaType}`;
    const entry = byTitle.get(key) ?? {
      tmdbId: row.tmdbId,
      mediaType: row.mediaType,
      title: row.title,
      posterPath: row.posterPath,
      viewers: new Set<string>(),
    };
    entry.viewers.add(row.ownerId);
    byTitle.set(key, entry);
  }
  const topTitles = [...byTitle.values()]
    .sort((a, b) => b.viewers.size - a.viewers.size)
    .slice(0, 10)
    .map((entry) => ({ tmdbId: entry.tmdbId, mediaType: entry.mediaType, title: entry.title, watchers: entry.viewers.size }));

  return Response.json({
    cards: {
      totalUsers,
      newToday,
      newWeek,
      active24h: active24h.length,
      active7d: active7d.length,
      active30d: active30d.length,
      suspended,
      deleted,
      verified,
      unverified: totalUsers - verified,
      twofa,
      sessionCount,
      commentCount,
      flaggedComments,
      watchlistCount,
      historyCount,
    },
    signupSeries,
    dauSeries,
    countries,
    browsers,
    devices,
    failedByIp,
    failedLogins24h: failedLogins.length,
    recentUsers: recentUsers.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })),
    topTitles,
    providerStats,
    announcement: announcements
      ? { id: announcements.id, message: announcements.message, active: announcements.active, createdAt: announcements.createdAt.toISOString() }
      : null,
  });
}

function buildDaySeries(dates: Date[], days: number): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

// ---------------------------------------------------------------------------
// USERS — searchable / sortable / filterable / paginated table (+ CSV export).
// ---------------------------------------------------------------------------
async function usersView(params: URLSearchParams, adminEmail: string) {
  const q = (params.get('q') ?? '').trim();
  const status = params.get('status') ?? ''; // active | suspended | deleted
  const role = params.get('role') ?? ''; // user | admin
  const country = params.get('country') ?? '';
  const verified = params.get('verified') ?? ''; // yes | no
  const twofa = params.get('twofa') ?? ''; // yes | no
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const sortParam = (params.get('sort') ?? 'createdAt') as UserSortColumn;
  const sort: UserSortColumn = sortParam in USER_SORT_COLUMNS ? sortParam : 'createdAt';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(5, Number(params.get('pageSize') ?? '25') || 25));
  const format = params.get('format') ?? '';

  const where = {
    AND: [
      q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {},
      status === 'suspended' ? { suspendedAt: { not: null } } : {},
      status === 'deleted' ? { deletedAt: { not: null } } : {},
      status === 'active' ? { suspendedAt: null, deletedAt: null } : {},
      role ? { role } : {},
      country ? { country } : {},
      verified === 'yes' ? { emailVerified: { not: null } } : {},
      verified === 'no' ? { emailVerified: null } : {},
      twofa === 'yes' ? { totpEnabled: true } : {},
      twofa === 'no' ? { totpEnabled: false } : {},
      from ? { createdAt: { gte: new Date(`${from}T00:00:00.000Z`) } } : {},
      to ? { createdAt: { lte: new Date(`${to}T23:59:59.999Z`) } } : {},
    ],
  };

  if (format === 'csv') {
    // Export EVERY matching row (no pagination) — audited like a read.
    const rows = await db.user.findMany({
      where,
      orderBy: { [USER_SORT_COLUMNS[sort]]: dir },
      select: {
        id: true, email: true, name: true, role: true, createdAt: true,
        country: true, city: true, suspendedAt: true, suspensionReason: true,
        deletedAt: true, emailVerified: true, totpEnabled: true, signupIp: true,
      },
    });
    await writeAudit({
      actorEmail: adminEmail,
      action: 'users.export_csv',
      targetType: 'user',
      details: { count: rows.length, filters: { q, status, role, country, verified, twofa, from, to } },
    });
    const csv = csvBody(
      ['id', 'email', 'name', 'role', 'created_at', 'country', 'city', 'suspended_at', 'suspension_reason', 'deleted_at', 'email_verified', 'totp_enabled', 'signup_ip'],
      rows.map((u) => [
        u.id, u.email, u.name, u.role, u.createdAt.toISOString(), u.country, u.city,
        u.suspendedAt?.toISOString() ?? '', u.suspensionReason ?? '', u.deletedAt?.toISOString() ?? '',
        u.emailVerified ? 'yes' : 'no', u.totpEnabled ? 'yes' : 'no', u.signupIp ?? '',
      ]),
    );
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="cinedeck-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { [USER_SORT_COLUMNS[sort]]: dir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        createdAt: true,
        country: true,
        city: true,
        suspendedAt: true,
        suspensionReason: true,
        suspensionEndsAt: true,
        deletedAt: true,
        emailVerified: true,
        totpEnabled: true,
        signupIp: true,
        _count: {
          select: {
            sessions: true,
            watchHistory: true,
            watchlistItems: true,
            comments: true,
            ratings: true,
          },
        },
      },
    }),
  ]);

  const lastSeen = await lastSeenByUser(users.map((u) => u.id));

  return Response.json({
    total,
    page,
    pageSize,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      avatar: u.avatar,
      createdAt: u.createdAt.toISOString(),
      country: u.country,
      city: u.city,
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
      suspensionReason: u.suspensionReason,
      suspensionEndsAt: u.suspensionEndsAt?.toISOString() ?? null,
      deletedAt: u.deletedAt?.toISOString() ?? null,
      emailVerified: u.emailVerified !== null,
      totpEnabled: u.totpEnabled,
      signupIp: u.signupIp,
      watchCount: u._count.watchHistory,
      watchlistSize: u._count.watchlistItems,
      commentCount: u._count.comments,
      ratingCount: u._count.ratings,
      sessionCount: u._count.sessions,
      lastSeenAt: lastSeen.get(u.id)?.toISOString() ?? null,
    })),
  });
}

// ---------------------------------------------------------------------------
// USER DETAIL — profile, flags, login history, sessions, activity, notes.
// ---------------------------------------------------------------------------
async function userDetailView(params: URLSearchParams) {
  const id = params.get('id') ?? '';
  if (!id) return jsonError('bad_request', 400);
  const historyPage = Math.max(1, Number(params.get('historyPage') ?? '1') || 1);

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, avatar: true,
      createdAt: true, updatedAt: true, emailVerified: true, totpEnabled: true,
      mustChangePassword: true, signupIp: true, country: true, city: true,
      suspendedAt: true, suspensionReason: true, suspensionEndsAt: true, deletedAt: true,
    },
  });
  if (!user) return jsonError('not_found', 404);

  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [loginHistory, loginTotal, sessions, history, watchlistCount, ratings, lists, comments, reports, notes, watchCount] =
    await Promise.all([
      db.loginAttempt.findMany({
        where: { userId: id, createdAt: { gte: since90 } },
        orderBy: { createdAt: 'desc' },
        skip: (historyPage - 1) * 20,
        take: 20,
        select: { id: true, success: true, reason: true, ip: true, userAgent: true, country: true, city: true, createdAt: true },
      }),
      db.loginAttempt.count({ where: { userId: id, createdAt: { gte: since90 } } }),
      db.session.findMany({
        where: { userId: id, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ip: true, country: true, city: true },
      }),
      db.watchHistory.findMany({
        where: { userId: id },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, title: true, mediaType: true, tmdbId: true, updatedAt: true },
      }),
      db.watchlistItem.count({ where: { userId: id } }),
      db.rating.findMany({
        where: { userId: id },
        select: { score: true },
      }),
      db.list.count({ where: { userId: id } }),
      db.comment.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, body: true, status: true, createdAt: true },
      }),
      db.report.findMany({
        where: { comment: { userId: id } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, reason: true, createdAt: true,
          comment: { select: { id: true, body: true, status: true } },
        },
      }),
      db.adminNote.findMany({
        where: { targetUserId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.watchHistory.count({ where: { userId: id } }),
    ]);

  const scores = ratings.map((r) => r.score).filter((s): s is number => s !== null);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return Response.json({
    user: {
      ...user,
      watchCount,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      emailVerified: user.emailVerified?.toISOString() ?? null,
      suspendedAt: user.suspendedAt?.toISOString() ?? null,
      suspensionEndsAt: user.suspensionEndsAt?.toISOString() ?? null,
      deletedAt: user.deletedAt?.toISOString() ?? null,
    },
    loginHistory: loginHistory.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    loginTotal,
    historyPage,
    loginPages: Math.max(1, Math.ceil(loginTotal / 20)),
    sessions: sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
    activity: {
      history: history.map((h) => ({ ...h, updatedAt: h.updatedAt.toISOString() })),
      watchlistCount,
      ratingCount: ratings.length,
      avgScore,
      lists,
      comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    },
    notes: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  });
}

// ---------------------------------------------------------------------------
// AUDIT LOG — immutable, paginated, searchable.
// ---------------------------------------------------------------------------
async function auditView(params: URLSearchParams) {
  const q = (params.get('q') ?? '').trim();
  const action = (params.get('action') ?? '').trim();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = 50;

  const where = {
    AND: [
      q ? { OR: [{ actorEmail: { contains: q } }, { targetLabel: { contains: q } }, { targetId: { contains: q } }] } : {},
      action ? { action } : {},
    ],
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return Response.json({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    entries: rows.map((row) => ({
      id: row.id,
      actorEmail: row.actorEmail,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      details: safeParse(row.details),
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// SESSIONS — every active session across accounts (metadata only).
// ---------------------------------------------------------------------------
async function sessionsView(params: URLSearchParams) {
  const q = (params.get('q') ?? '').trim();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = 50;

  const where = {
    expiresAt: { gt: new Date() },
    ...(q
      ? { user: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        userAgent: true,
        ip: true,
        country: true,
        city: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);

  return Response.json({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    sessions: rows.map((row) => ({
      id: row.id,
      email: row.user?.email ?? 'unknown',
      userName: row.user?.name ?? null,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      userAgent: row.userAgent,
      ip: row.ip,
      country: row.country,
      city: row.city,
    })),
  });
}

// ---------------------------------------------------------------------------
// REPORTS — reported comments for moderation.
// ---------------------------------------------------------------------------
async function reportsView() {
  const reports = await db.report.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      comment: {
        select: {
          id: true,
          body: true,
          status: true,
          createdAt: true,
          authorName: true,
          user: { select: { id: true, email: true } },
        },
      },
    },
  });
  return Response.json({
    reports: reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      commentId: r.comment.id,
      commentBody: r.comment.body,
      commentStatus: r.comment.status,
      commentCreatedAt: r.comment.createdAt.toISOString(),
      authorName: r.comment.authorName,
      authorEmail: r.comment.user?.email ?? null,
      authorId: r.comment.user?.id ?? null,
    })),
  });
}

// ---------------------------------------------------------------------------
// POST — every admin action (audited). guardMutation = origin + rate limit.
// ---------------------------------------------------------------------------
const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('deleteComment'), id: z.string().min(1) }),
  z.object({ action: z.literal('approveComment'), id: z.string().min(1) }),
  z.object({ action: z.literal('promoteUser'), id: z.string().min(1), admin: z.boolean() }),
  z.object({ action: z.literal('revokeSession'), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('suspendUser'), id: z.string().min(1), reason: z.string().trim().min(3).max(300), endsAt: z.string().datetime().optional() }),
  z.object({ action: z.literal('unsuspendUser'), id: z.string().min(1) }),
  z.object({ action: z.literal('forceLogout'), id: z.string().min(1) }),
  z.object({ action: z.literal('resetTotp'), id: z.string().min(1) }),
  z.object({ action: z.literal('sendPasswordReset'), id: z.string().min(1) }),
  z.object({ action: z.literal('verifyEmail'), id: z.string().min(1) }),
  z.object({ action: z.literal('softDeleteUser'), id: z.string().min(1) }),
  z.object({ action: z.literal('hardDeleteUser'), id: z.string().min(1), confirm: z.literal('DELETE') }),
  z.object({ action: z.literal('reactivateUser'), id: z.string().min(1) }),
  z.object({ action: z.literal('addNote'), id: z.string().min(1), body: z.string().trim().min(2).max(1000) }),
  z.object({ action: z.literal('bulkSuspend'), ids: z.array(z.string().min(1)).min(1).max(200), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('bulkDelete'), ids: z.array(z.string().min(1)).min(1).max(200) }),
  z.object({ action: z.literal('dismissReport'), reportId: z.string().min(1) }),
  z.object({ action: z.literal('setAnnouncement'), message: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal('clearAnnouncement'), id: z.string().min(1).optional() }),
]);

export const POST = withApi('admin-post', async (request) => {
  const guard = guardMutation(request, 'account');
  if (guard) return guard;

  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const body = await readJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);
  const input = parsed.data;

  const loadUser = async (id: string) =>
    db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, suspendedAt: true } });
  const auditAction = (
    action: string,
    target: { id?: string | null; label?: string | null; type?: string },
    details: Record<string, unknown> = {},
  ) =>
    writeAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      action,
      targetType: target.type ?? 'user',
      targetId: target.id ?? null,
      targetLabel: target.label ?? null,
      details,
    });

  switch (input.action) {
    case 'deleteComment': {
      const comment = await db.comment.findUnique({ where: { id: input.id }, select: { authorName: true } });
      await db.comment.update({ where: { id: input.id }, data: { status: 'removed' } });
      await auditAction('comment.removed', { id: input.id, type: 'comment', label: comment?.authorName ?? input.id });
      return Response.json({ ok: true });
    }
    case 'approveComment': {
      await db.comment.update({ where: { id: input.id }, data: { status: 'visible' } });
      await auditAction('comment.approved', { id: input.id, type: 'comment' });
      return Response.json({ ok: true });
    }
    case 'dismissReport': {
      await db.report.deleteMany({ where: { id: input.reportId } });
      await auditAction('report.dismissed', { id: input.reportId, type: 'comment' });
      return Response.json({ ok: true });
    }
    case 'promoteUser': {
      if (input.id === admin.id) return apiError(400, 'bad_request', 'You cannot change your own role.');
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({ where: { id: input.id }, data: { role: input.admin ? 'admin' : 'user' } });
      await auditAction(input.admin ? 'user.promoted' : 'user.demoted', { id: target.id, label: target.email }, { role: input.admin ? 'admin' : 'user' });
      return Response.json({ ok: true });
    }
    case 'revokeSession': {
      await db.session.deleteMany({ where: { id: input.id } });
      await auditAction('session.revoked', { id: input.id, type: 'session' });
      return Response.json({ ok: true });
    }
    case 'suspendUser': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      if (target.role === 'admin' && target.id !== admin.id) {
        // Admins can only be suspended by... this admin — allow but audit loudly.
      }
      await db.user.update({
        where: { id: input.id },
        data: {
          suspendedAt: new Date(),
          suspensionReason: input.reason,
          suspensionEndsAt: input.endsAt ? new Date(input.endsAt) : null,
        },
      });
      // PHASE 4: suspension invalidates every existing session immediately.
      await db.session.deleteMany({ where: { userId: input.id } });
      await auditAction('user.suspended', { id: target.id, label: target.email }, { reason: input.reason, endsAt: input.endsAt ?? null, sessionsRevoked: true });
      return Response.json({ ok: true });
    }
    case 'unsuspendUser': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({
        where: { id: input.id },
        data: { suspendedAt: null, suspensionReason: null, suspensionEndsAt: null },
      });
      await auditAction('user.unsuspended', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'forceLogout': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      const result = await db.session.deleteMany({ where: { userId: input.id } });
      await auditAction('user.force_logout', { id: target.id, label: target.email }, { revoked: result.count });
      return Response.json({ ok: true, revoked: result.count });
    }
    case 'resetTotp': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({ where: { id: input.id }, data: { totpEnabled: false, totpSecret: null, backupCodes: null } });
      await auditAction('user.twofa_reset', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'sendPasswordReset': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      const { token } = signStatelessToken('reset', target.id, 30 * 60);
      const resetUrl = `${appBaseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
      await mailer().send({
        to: target.email,
        subject: 'CineDeck password reset',
        text: `An administrator started a password reset for your account.\n\nReset it within 30 minutes:\n${resetUrl}\n\nIf you didn't expect this, ignore the message.`,
        actionUrl: resetUrl,
      });
      await auditAction('user.password_reset_sent', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'verifyEmail': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({ where: { id: input.id }, data: { emailVerified: new Date() } });
      await auditAction('user.email_verified_manually', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'softDeleteUser': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
      await db.session.deleteMany({ where: { userId: input.id } });
      await auditAction('user.soft_deleted', { id: target.id, label: target.email }, { graceDays: 30 });
      return Response.json({ ok: true });
    }
    case 'hardDeleteUser': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.delete({ where: { id: input.id } });
      await auditAction('user.hard_deleted', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'reactivateUser': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.user.update({ where: { id: input.id }, data: { deletedAt: null, suspendedAt: null, suspensionReason: null, suspensionEndsAt: null } });
      await auditAction('user.reactivated', { id: target.id, label: target.email });
      return Response.json({ ok: true });
    }
    case 'addNote': {
      const target = await loadUser(input.id);
      if (!target) return jsonError('not_found', 404);
      await db.adminNote.create({
        data: { targetUserId: input.id, authorEmail: admin.email, body: input.body },
      });
      await auditAction('user.note_added', { id: target.id, label: target.email }, { noteLength: input.body.length });
      return Response.json({ ok: true });
    }
    case 'bulkSuspend': {
      const targets = await db.user.findMany({ where: { id: { in: input.ids }, deletedAt: null }, select: { id: true, email: true } });
      for (const target of targets) {
        await db.user.update({
          where: { id: target.id },
          data: { suspendedAt: new Date(), suspensionReason: input.reason, suspensionEndsAt: null },
        });
        await db.session.deleteMany({ where: { userId: target.id } });
        await auditAction('user.suspended', { id: target.id, label: target.email }, { bulk: true, reason: input.reason });
      }
      return Response.json({ ok: true, affected: targets.length });
    }
    case 'bulkDelete': {
      const targets = await db.user.findMany({ where: { id: { in: input.ids } }, select: { id: true, email: true } });
      for (const target of targets) {
        await db.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
        await db.session.deleteMany({ where: { userId: target.id } });
        await auditAction('user.soft_deleted', { id: target.id, label: target.email }, { bulk: true, graceDays: 30 });
      }
      return Response.json({ ok: true, affected: targets.length });
    }
    case 'setAnnouncement': {
      await db.announcement.updateMany({ where: { active: true }, data: { active: false } });
      const created = await db.announcement.create({ data: { message: input.message, active: true } });
      await auditAction('announcement.set', { id: created.id, type: 'announcement', label: input.message.slice(0, 60) });
      return Response.json({ ok: true, id: created.id });
    }
    case 'clearAnnouncement': {
      await db.announcement.updateMany({ where: input.id ? { id: input.id } : { active: true }, data: { active: false } });
      await auditAction('announcement.cleared', { type: 'announcement', id: input.id ?? null });
      return Response.json({ ok: true });
    }
  }
});
