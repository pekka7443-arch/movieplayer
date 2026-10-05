'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/hooks/use-session';
import {
  fetchNotifications,
  markNotificationsRead,
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

  const query = useQuery<{ items: NotificationRow[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!user) return null;

  const unread = query.data?.unread ?? 0;
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={open}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
          className="relative size-10 shrink-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
        >
          {unread > 0 ? (
            <BellRing className="size-4.5 text-brand" aria-hidden />
          ) : (
            <Bell className="size-4.5" aria-hidden />
          )}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-brand-foreground" aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-xl border-zinc-200 p-1.5 dark:border-zinc-800">
        <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Notifications
        </p>
        {items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Nothing yet — save shows to My List and CineDeck will tell you when new episodes drop.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
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
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

void toast;
