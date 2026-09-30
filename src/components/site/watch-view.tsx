'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlayerSection } from '@/components/site/player-section';
import { InfoSection } from '@/components/site/info-section';
import { SimilarRow } from '@/components/site/similar-row';
import { useMediaDetails, useSaveHistory } from '@/hooks/use-media';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey, useSettings } from '@/lib/settings';
import type { MediaType } from '@/lib/tmdb';

export function WatchView({
  tmdbId,
  mediaType,
  season,
  episode,
}: {
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const language = useCinedeckStore((s) => s.language);
  const resetServer = useCinedeckStore((s) => s.resetServer);
  const hasKey = useHasTmdbKey();
  const settings = useSettings();

  const detailsQuery = useMediaDetails(tmdbId, mediaType, language, hasKey);
  const details = detailsQuery.data;
  const saveHistory = useSaveHistory();

  // Switching titles resets the server to the user's preferred one.
  useEffect(() => {
    resetServer();
  }, [tmdbId, mediaType, resetServer]);

  // Upsert into watch history. Keyed by id:type:season:episode so episode
  // navigation updates the entry (backend upserts by [tmdbId, mediaType]).
  // In key mode we wait for the real title (fallback: "TMDB #id").
  useEffect(() => {
    if (!settings.saveHistory) return;
    if (hasKey && detailsQuery.isPending) return;
    saveHistory.mutate({
      tmdbId,
      mediaType,
      title: details?.title ?? `TMDB #${tmdbId}`,
      posterPath: details?.posterPath ?? null,
      backdropPath: details?.backdropPath ?? null,
      season: mediaType === 'tv' ? season : null,
      episode: mediaType === 'tv' ? episode : null,
    });
    // History upsert is safe to re-fire (backend upserts by [tmdbId, mediaType]).
    // `saveHistory.mutate` is a stable callback and intentionally omitted.
  }, [tmdbId, mediaType, season, episode, settings.saveHistory, details?.title, hasKey, detailsQuery.isPending]);

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.push('/', { scroll: false })}
        className="mb-5 h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to browse
      </Button>

      <PlayerSection
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        details={details}
        detailsLoading={detailsQuery.isPending}
        hasKey={hasKey}
      />

      <InfoSection
        tmdbId={tmdbId}
        mediaType={mediaType}
        details={details}
        detailsLoading={detailsQuery.isPending}
      />

      {hasKey && (
        <SimilarRow
          similar={details?.similar}
          mediaType={mediaType}
          loading={detailsQuery.isPending}
        />
      )}
    </motion.div>
  );
}
