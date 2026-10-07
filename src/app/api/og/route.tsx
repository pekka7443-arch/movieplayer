import { ImageResponse } from 'next/og';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/og?share=token → dynamic Open Graph card for a shared public list.
// The token is the capability: private/unknown tokens render the neutral
// branded card (never leak existence).
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('share') ?? '';

  let name = 'A shared list';
  let description: string | null = null;
  let count = 0;
  let posters: string[] = [];

  if (token) {
    try {
      const list = await db.list.findUnique({ where: { shareToken: token } });
      if (list && list.isPublic) {
        name = list.name;
        description = list.description;
        const members = await db.listMember.findMany({
          where: { listId: list.id },
          orderBy: { position: 'asc' },
          take: 3,
          select: { posterPath: true },
        });
        // Fetch + verify each poster server-side; broken/404 posters are
        // skipped so a bad row can never break the whole card render.
        const fetched = await Promise.all(
          members
            .map((m) => m.posterPath)
            .filter((p): p is string => Boolean(p))
            .slice(0, 3)
            .map(async (p) => {
              try {
                const res = await fetch(`https://image.tmdb.org/t/p/w342${p}`, {
                  signal: AbortSignal.timeout(4000),
                });
                if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null;
                const buf = Buffer.from(await res.arrayBuffer());
                return `data:${res.headers.get('content-type')};base64,${buf.toString('base64')}`;
              } catch {
                return null;
              }
            }),
        );
        posters = fetched.filter((p): p is string => Boolean(p));
        count = await db.listMember.count({ where: { listId: list.id } });
      }
    } catch {
      // fall through to the neutral card
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #09090b 0%, #18181b 55%, #27272a 100%)',
          padding: 64,
          color: '#fafafa',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 800,
              color: '#09090b',
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>CineDeck</span>
            <span style={{ fontSize: 18, color: '#a1a1aa' }}>{count > 0 ? `${count} titles` : 'Curated picks'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5 }}>
            {name.length > 60 ? `${name.slice(0, 57)}…` : name}
          </div>
          {description ? (
            <div style={{ fontSize: 26, color: '#d4d4d8', display: 'flex' }}>
              {description.length > 110 ? `${description.slice(0, 107)}…` : description}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {posters.map((src, i) => (
              <img
                key={src.slice(-24)}
                src={src}
                alt="Movie poster"
                width={120}
                height={180}
                style={{
                  borderRadius: 12,
                  border: '2px solid #3f3f46',
                  objectFit: 'cover',
                  marginBottom: i === 1 ? 10 : 0,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 22, color: '#71717a' }}>Watch free at CineDeck</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
