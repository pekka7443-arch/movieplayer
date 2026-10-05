import { db } from '@/lib/db';
import { withApi, apiError } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

// GET /api/lists/share?token= → a public list's items. No auth — the token
// IS the capability. Private lists are 404 even with the token.
export const GET = withApi('list-share', async (request) => {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!token) return apiError(400, 'bad_request');

  const list = await db.list.findUnique({
    where: { shareToken: token },
    select: { name: true, description: true, isPublic: true, updatedAt: true },
  });
  if (!list || !list.isPublic) {
    return apiError(404, 'not_found');
  }

  const items = await db.listMember.findMany({
    where: { listId: (await db.list.findUnique({ where: { shareToken: token }, select: { id: true } }))?.id },
    orderBy: { position: 'asc' },
  });

  return Response.json({
    list: { name: list.name, description: list.description, updatedAt: list.updatedAt.toISOString() },
    items: items.map((row) => ({
      tmdbId: row.tmdbId,
      mediaType: row.mediaType === 'tv' ? 'tv' : 'movie',
      title: row.title,
      posterPath: row.posterPath,
    })),
  });
});
