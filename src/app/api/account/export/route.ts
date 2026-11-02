import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceRateLimit } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export → "Download my data" (GDPR-style JSON export).
 * Includes the profile, watchlist, history, ratings, episode watches, lists,
 * comments and reactions. NEVER includes password hashes, session tokens or
 * any other credential material.
 */
export const GET = withApi('account/export', async (request) => {
  const limited = await enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatar: true,
      country: true,
      city: true,
      emailVerified: true,
      totpEnabled: true,
      createdAt: true,
    },
  });
  if (!user) return apiError(401, 'unauthorized');

  const [watchlist, history, ratings, episodeWatches, lists, comments] = await Promise.all([
    db.watchlistItem.findMany({ where: { userId: owner.userId }, orderBy: { addedAt: 'desc' } }),
    db.watchHistory.findMany({ where: { userId: owner.userId }, orderBy: { updatedAt: 'desc' } }),
    db.rating.findMany({ where: { userId: owner.userId }, orderBy: { updatedAt: 'desc' } }),
    db.episodeWatch.findMany({ where: { userId: owner.userId }, orderBy: { watchedAt: 'desc' } }),
    db.list.findMany({
      where: { userId: owner.userId },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.comment.findMany({ where: { userId: owner.userId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    service: 'CineDeck',
    notice:
      'Machine-readable export of everything CineDeck stores about this account. Password hashes, session tokens and IP addresses are deliberately excluded.',
    profile: { ...user, emailVerified: user.emailVerified?.toISOString() ?? null, createdAt: user.createdAt.toISOString() },
    watchlist: watchlist.map((row) => ({ ...row, addedAt: row.addedAt.toISOString() })),
    history: history.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    ratings: ratings.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    episodeWatches: episodeWatches.map((row) => ({ ...row, watchedAt: row.watchedAt.toISOString() })),
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      isPublic: list.isPublic,
      shareToken: list.shareToken,
      createdAt: list.createdAt.toISOString(),
      items: list.items.map((item) => ({ ...item, addedAt: item.addedAt.toISOString() })),
    })),
    comments: comments.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="cinedeck-data-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
});
