'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Star, UserCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/site/empty-state';
import { useSession } from '@/hooks/use-session';
import { useCinedeckStore } from '@/lib/store';

interface PublicProfile {
  user: {
    id: string;
    username: string | null;
    name: string | null;
    bio: string | null;
    avatar: string | null;
    isPublicProfile: boolean;
    joinedAt: string;
  };
  stats: {
    hoursWatched: number;
    titlesOpened: number;
    ratingsCount: number;
    followers: number;
    following: number;
  };
  ratings: { tmdbId: number; mediaType: 'movie' | 'tv'; score: number; updatedAt: string }[];
  lists: { name: string; description: string | null; count: number; shareUrl: string }[];
  isFollowing: boolean;
}

/** Inline editor for your own profile — state seeds once from props. */
function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: PublicProfile['user'];
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(profile.username ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [isPublic, setIsPublic] = useState(profile.isPublicProfile);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/social/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim() ? username.trim().toLowerCase() : null,
          bio: bio.trim() || null,
          isPublicProfile: isPublic,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Could not save profile');
      }
      toast.success('Profile saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mt-6 space-y-4 rounded-lg border border-border bg-background/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Handle (3–24: a-z, 0-9, -)</span>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="movie-fan"
            className="font-mono"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Bio (max 280)</span>
          <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Something about your taste…" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Make profile public" />
          <span>
            <span className="font-medium">Public profile</span>
            <span className="ml-2 text-xs text-muted-foreground">
              shows your stats, scores and public lists at /?user=handle
            </span>
          </span>
        </label>
        <Button type="button" onClick={save} disabled={busy} className="bg-brand text-white hover:bg-brand/90">
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Public profile (/?user=<handle>) — avatar, bio, joined date, watch stats,
 * recent scores and public lists, with a Follow/Unfollow button. Viewing
 * your own profile reveals inline edit controls (handle, bio, visibility).
 */
export function PublicProfileView({ username }: { username: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: me } = useSession();
  const openAuth = useCinedeckStore((s) => s.openAuth);

  const query = useQuery<PublicProfile>({
    queryKey: ['social-profile', username],
    queryFn: async () => {
      const res = await fetch(`/api/social/profile?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error('profile_unavailable');
      return (await res.json()) as PublicProfile;
    },
    retry: 1,
    staleTime: 30_000,
  });

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isOwn = Boolean(me && query.data && me.id === query.data.user.id);

  const toggleFollow = async () => {
    if (!me) {
      openAuth('signin', { notice: 'Sign in to follow this CineDeck member' });
      return;
    }
    if (!query.data) return;
    setBusy(true);
    try {
      const res = await fetch('/api/social/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: query.data.user.id }),
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { following: boolean };
      toast.success(data.following ? 'Following' : 'Unfollowed');
      void queryClient.invalidateQueries({ queryKey: ['social-profile', username] });
    } catch {
      toast.error('Could not update follow — try again');
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg bg-muted" />
        <Skeleton className="h-8 w-64 rounded-lg bg-muted" />
        <Skeleton className="h-40 w-full rounded-lg bg-muted" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState
        variant="search"
        title="Profile not found"
        subtitle={`No public profile at @${username}. Members choose their own handle and make their profile public in settings.`}
        actionLabel="Browse titles"
        onAction={() => router.push('/', { scroll: false })}
      />
    );
  }

  const data = query.data;
  const joined = new Date(data.user.joinedAt).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-8">
      {/* Header card */}
      <section className="relative overflow-hidden rounded-lg border border-border bg-card p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-80 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-brand text-3xl font-bold text-white shadow-lg">
            {data.user.avatar ? (
              <span aria-hidden>{data.user.avatar}</span>
            ) : (
              (data.user.name ?? data.user.username ?? '?').slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {data.user.name || data.user.username}
            </h1>
            <p className="mt-0.5 text-sm font-medium text-brand">@{data.user.username}</p>
            {isOwn && !data.user.isPublicProfile && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                This profile is private — only you can see it. Flip on “Public profile” below to share it.
              </p>
            )}
            {data.user.bio && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {data.user.bio}
              </p>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                Joined {joined}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden />
                {data.stats.followers} followers · {data.stats.following} following
              </span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isOwn ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing((v) => !v)}
                className="gap-1.5"
              >
                <Pencil className="size-4" aria-hidden />
                Edit profile
              </Button>
            ) : (
              <Button
                type="button"
                onClick={toggleFollow}
                disabled={busy}
                variant={data.isFollowing ? 'outline' : 'default'}
                className={data.isFollowing ? '' : 'bg-brand text-white hover:bg-brand/90'}
              >
                {data.isFollowing ? (
                  <>
                    <UserCheck className="size-4" aria-hidden />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4" aria-hidden />
                    Follow
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {isOwn && editing && (
          <ProfileEditor
            profile={data.user}
            onSaved={() => {
              setEditing(false);
              void queryClient.invalidateQueries({ queryKey: ['social-profile', username] });
            }}
          />
        )}
      </section>

      {/* Stats strip */}
      <section aria-label="Watch stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          { label: 'Hours watched', value: data.stats.hoursWatched },
          { label: 'Titles opened', value: data.stats.titlesOpened },
          { label: 'Ratings given', value: data.stats.ratingsCount },
          { label: 'Public lists', value: data.lists.length },
        ]).map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card px-4 py-3 text-center">
            <p className="font-mono text-2xl font-bold tabular-nums text-foreground">{stat.value}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </section>

      {/* Recent ratings */}
      {data.ratings.length > 0 && (
        <section aria-label="Recent ratings">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight md:text-2xl">
            <span className="h-4 w-1 rounded-full bg-brand md:h-5" aria-hidden />
            Recent scores
          </h2>
          <ul className="flex flex-wrap gap-2.5">
            {data.ratings.map((r) => (
              <li key={`${r.tmdbId}-${r.mediaType}`}>
                <button
                  type="button"
                  onClick={() => router.push(`/?id=${r.tmdbId}&type=${r.mediaType}`, { scroll: false })}
                  className="flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3.5 text-sm transition-colors hover:border-brand/40"
                >
                  <span className="flex items-center gap-0.5 font-bold text-brand">
                    <Star className="size-3.5 fill-brand" aria-hidden />
                    {r.score}
                  </span>
                  <span className="text-muted-foreground">/10</span>
                  <span className="font-mono text-[10px] text-muted-foreground">#{r.tmdbId}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Public lists */}
      {data.lists.length > 0 && (
        <section aria-label="Public lists">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight md:text-2xl">
            <span className="h-4 w-1 rounded-full bg-brand md:h-5" aria-hidden />
            Public lists
          </h2>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {data.lists.map((list) => (
              <li key={list.shareUrl}>
                <button
                  type="button"
                  onClick={() => router.push(list.shareUrl, { scroll: false })}
                  className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40"
                >
                  <p className="truncate text-sm font-semibold text-foreground">{list.name}</p>
                  {list.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{list.description}</p>
                  )}
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {list.count} titles
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
