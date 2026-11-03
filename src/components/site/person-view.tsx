'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Film, MapPin, Tv, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaCard } from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
import { getTmdbKey } from '@/lib/settings';

interface PersonPayload {
  person: {
    id: number;
    name: string;
    biography: string;
    birthday: string | null;
    deathday: string | null;
    placeOfBirth: string | null;
    department: string | null;
    profilePath: string | null;
  };
  filmography: {
    id: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath: string | null;
    releaseDate: string;
    voteAverage: number;
    credit: string;
    episodeCount: number | null;
  }[];
}

/** Person view (?person=tmdbId) — bio + filmography. Requires a TMDB key. */
export function PersonView({ personId }: { personId: number }) {
  const router = useRouter();
  const hasKey = Boolean(getTmdbKey());

  const query = useQuery<PersonPayload>({
    queryKey: ['person', personId],
    queryFn: async () => {
      const res = await fetch(`/api/tmdb/person/${personId}`, {
        headers: { 'x-tmdb-key': getTmdbKey() },
      });
      if (!res.ok) throw new Error(`person_${res.status}`);
      return (await res.json()) as PersonPayload;
    },
    enabled: hasKey && personId > 0,
    staleTime: 30 * 60_000,
    retry: 0,
  });

  if (!hasKey) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
        <UserRound className="mx-auto size-8 text-zinc-400" aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-zinc-800 dark:text-zinc-200">People pages need a TMDB key</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Add your free TMDB API key in Settings to browse actors, directors and their filmographies.
        </p>
      </div>
    );
  }

  const person = query.data?.person;
  const filmography = query.data?.filmography ?? [];

  return (
    <div className="space-y-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.push('/', { scroll: false })}
        className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to browse
      </Button>

      {query.isPending ? (
        <div className="flex gap-6">
          <Skeleton className="h-56 w-40 rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
          <div className="flex-1 space-y-3 py-2">
            <Skeleton className="h-8 w-64 rounded-lg bg-zinc-200 dark:bg-zinc-900" />
            <Skeleton className="h-4 w-full rounded bg-zinc-200 dark:bg-zinc-900" />
            <Skeleton className="h-4 w-5/6 rounded bg-zinc-200 dark:bg-zinc-900" />
          </div>
        </div>
      ) : query.isError || !person ? (
        <p className="py-10 text-center text-sm text-zinc-500">Person not found.</p>
      ) : (
        <>
          <header className="flex flex-col gap-5 sm:flex-row">
            {person.profilePath ? (
              <img
                src={`https://image.tmdb.org/t/p/w342${person.profilePath}`}
                alt={`Portrait of ${person.name}`}
                width={185}
                height={278}
                loading="eager"
                className="w-40 shrink-0 rounded-2xl border border-zinc-200 object-cover dark:border-zinc-800"
              />
            ) : (
              <span className="flex h-56 w-40 shrink-0 items-center justify-center rounded-2xl bg-zinc-200 dark:bg-zinc-900">
                <UserRound className="size-10 text-zinc-400" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
                {person.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                {person.department && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                    {person.department}
                  </span>
                )}
                {person.birthday && (
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" aria-hidden />
                    {person.birthday}
                    {person.deathday ? ` – ${person.deathday}` : ''}
                  </span>
                )}
                {person.placeOfBirth && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden />
                    {person.placeOfBirth}
                  </span>
                )}
              </div>
              {person.biography && (
                <p className="mt-3 line-clamp-[10] max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {person.biography}
                </p>
              )}
            </div>
          </header>

          {filmography.length > 0 && (
            <section aria-label="Filmography">
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                <span className="size-4 rounded-full bg-brand md:h-5 md:w-1" aria-hidden />
                {person.department === 'Directing' ? 'Directing credits' : 'Filmography'}
                <span className="text-xs font-normal text-zinc-500">{filmography.length} titles</span>
              </h2>
              <MediaRow label="Filmography">
                {filmography.map((credit) => (
                  <div key={`${credit.id}-${credit.credit}`} className="relative">
                    <MediaCard
                      item={{
                        id: credit.id,
                        mediaType: credit.mediaType,
                        title: credit.title,
                        posterPath: credit.posterPath,
                        releaseDate: credit.releaseDate,
                        voteAverage: credit.voteAverage,
                      }}
                    />
                    {credit.credit && (
                      <span className="pointer-events-none absolute inset-x-1.5 bottom-[74px] z-10 truncate rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
                        {credit.credit}
                        {credit.episodeCount ? ` · ${credit.episodeCount} eps` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </MediaRow>
            </section>
          )}
          {filmography.length === 0 && (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
              {person.department === 'Directing' ? <Film className="size-4" aria-hidden /> : <Tv className="size-4" aria-hidden />}
              No credits found.
            </p>
          )}
        </>
      )}
    </div>
  );
}
