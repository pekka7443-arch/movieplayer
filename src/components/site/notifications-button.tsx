'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Bell, BellRing, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/hooks/use-session';
import { useHydrated } from '@/hooks/use-hydrated';
import { useSettings } from '@/lib/settings';
import {
  fetchNotifications,
  markNotificationsRead,
  deleteNotifications,
  type NotificationRow,
} from '@/lib/library';

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Header notifications bell — new episodes of followed shows + system news. */
export function NotificationsButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  // The bell only exists for signed-in users, and "signed-in" is known from
  // the localStorage session cache — gate it until hydration so a signed-in
  // reload never mismatches the guest SSR HTML.
  const hydrated = useHydrated();
  const settings = useSettings();

  const query = useQuery<{ items: NotificationRow[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    // The user's Watchlist-alerts setting gates polling entirely.
    enabled: Boolean(user) && settings.notificationsEnabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const unread = query.data?.unread ?? 0;

  // PWA app badge (setAppBadge where supported — Android/Chrome; harmless no-op elsewhere).
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (typeof nav.setAppBadge !== 'function') return;
    try {
      if (unread > 0) void nav.setAppBadge(unread).catch(() => undefined);
      else void nav.clearAppBadge?.().catch(() => undefined);
    } catch {
      // unsupported — badge is a progressive enhancement
    }
  }, [unread]);

  if (!hydrated || !user) return null;

  const items = (query.data?.items ?? []).slice(0, 12);

  const open = async () => {
    if (unread > 0) {
      await markNotificationsRead(true).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  const openTitle = (item: NotificationRow) => {
    if (item.tmdbId && item.mediaType) {
      const params = new URLSearchParams({ id: String(item.tmdbId), type: item.mediaType });
      if (item.season) params.set('s', String(item.season));
      if (item.episode) params.set('e', String(item.episode));
      router.push(`/?${params.toString()}`, { scroll: false });
    }
  };

  const removeOne = (item: NotificationRow) => {
    void deleteNotifications({ id: item.id })
      .then(() => {
        toast.success('Notification removed');
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => toast.error('Could not remove notification'));
  };

  const removeAll = () => {
    void deleteNotifications({ all: true })
      .then(() => {
        toast.success('All notifications cleared');
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => toast.error('Could not clear notifications'));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={open}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
          className="relative size-9 max-md:size-10 shrink-0 text-zinc-500 hover:text-foreground hover:bg-white/5 dark:text-zinc-400 dark:hover:text-foreground dark:hover:bg-white/5"
        >
          {unread > 0 ? (
            <BellRing className="size-[17px] text-brand" aria-hidden />
          ) : (
            <Bell className="size-[17px]" aria-hidden />
          )}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-brand-foreground" aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-xl p-1.5">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Notifications
          </p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={removeAll}
              className="rounded-md text-[11px] font-medium text-zinc-400 transition-colors hover:text-brand"
            >
              Clear all
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Nothing yet — save shows to My List and CineDeck will tell you when new episodes drop.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="group/item relative">
                <button
                  type="button"
                  onClick={() => openTitle(item)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span
                    className={
                      'mt-1 size-2 shrink-0 rounded-full ' +
                      (item.read ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-brand')
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {item.title}
                    </span>
                    <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{item.text}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-400">{timeAgo(item.createdAt)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete notification: ${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeOne(item);
                  }}
                  className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover/item:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
