import type { WatchlistItem } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface WatchlistEntry {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  addedAt: string;
}

function serializeWatchlistRow(row: WatchlistItem): WatchlistEntry {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType === "tv" ? "tv" : "movie",
    title: row.title,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    addedAt: row.addedAt.toISOString(),
  };
}

const watchlistPostSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(["movie", "tv"]),
  title: z.string().min(1),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
});

function badRequest(): Response {
  return Response.json({ error: "bad_request" }, { status: 400 });
}

// GET /api/watchlist → most recent 24 watchlist entries.
export async function GET() {
  const rows = await db.watchlistItem.findMany({
    orderBy: { addedAt: "desc" },
    take: 24,
  });
  return Response.json({ items: rows.map(serializeWatchlistRow) });
}

// POST /api/watchlist → idempotent create on [tmdbId, mediaType].
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }

  const parsed = watchlistPostSchema.safeParse(body);
  if (!parsed.success) return badRequest();

  const { tmdbId, mediaType, title } = parsed.data;
  const posterPath = parsed.data.posterPath ?? null;
  const backdropPath = parsed.data.backdropPath ?? null;

  const existing = await db.watchlistItem.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (existing) {
    return Response.json({ item: serializeWatchlistRow(existing) });
  }

  const row = await db.watchlistItem.create({
    data: { tmdbId, mediaType, title, posterPath, backdropPath },
  });
  return Response.json({ item: serializeWatchlistRow(row) });
}

// DELETE /api/watchlist?id=<rowId> | ?all=1
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("all") === "1") {
    await db.watchlistItem.deleteMany({});
    return Response.json({ ok: true });
  }

  const id = searchParams.get("id");
  if (!id) return badRequest();

  await db.watchlistItem.deleteMany({ where: { id } });
  return Response.json({ ok: true });
}
