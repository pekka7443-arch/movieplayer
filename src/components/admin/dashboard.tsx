'use client';

// Admin dashboard shell — a focused SaaS console (Linear / Vercel style):
// fixed 220px sidebar, breadcrumb top bar with refresh indicator, keyboard
// shortcuts (G+O / G+U / G+S / G+L), 100ms fade between views and an
// icon-only bottom nav on mobile. Role-gated client-side; every API stays
// server-gated.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  ToggleLeft,
  Users,
} from 'lucide-react';

import { logoutAccount } from '@/lib/auth-client';
import { invalidateIdentityCaches, useSession } from '@/hooks/use-session';
import { useHydrated } from '@/hooks/use-hydrated';
import { cn } from '@/lib/utils';
import { AdmButton, Avatar, UpdatedAgo } from '@/components/admin/ui';

// Tab views are code-split so each console section ships on demand.
const OverviewTab = dynamic(() => import('@/components/admin/overview-tab').then((m) => m.OverviewTab), { ssr: false, loading: () => <TabSkeleton /> });
const UsersTab = dynamic(() => import('@/components/admin/users-tab').then((m) => m.UsersTab), { ssr: false, loading: () => <TabSkeleton /> });
const SessionsTab = dynamic(() => import('@/components/admin/sessions-tab').then((m) => m.SessionsTab), { ssr: false, loading: () => <TabSkeleton /> });
const ModerationTab = dynamic(() => import('@/components/admin/moderation-tab').then((m) => m.ModerationTab), { ssr: false, loading: () => <TabSkeleton /> });
const AuditTab = dynamic(() => import('@/components/admin/audit-tab').then((m) => m.AuditTab), { ssr: false, loading: () => <TabSkeleton /> });
const FlagsTab = dynamic(() => import('@/components/admin/flags-tab').then((m) => m.FlagsTab), { ssr: false, loading: () => <TabSkeleton /> });
const UxTab = dynamic(() => import('@/components/admin/ux-tab').then((m) => m.UxTab), { ssr: false, loading: () => <TabSkeleton /> });
const SystemTab = dynamic(() => import('@/components/admin/system-tab').then((m) => m.SystemTab), { ssr: false, loading: () => <TabSkeleton /> });
const SettingsTab = dynamic(() => import('@/components/admin/settings-tab').then((m) => m.SettingsTab), { ssr: false, loading: () => <TabSkeleton /> });

function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-8 w-48 animate-pulse rounded bg-[#111111]" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-[#111111]" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-[#111111]" />
    </div>
  );
}

interface NavItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: typeof LayoutDashboard;
  path: string;
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'sessions', label: 'Sessions', icon: Activity, path: '/admin/sessions' },
  { id: 'moderation', label: 'Moderation', icon: ClipboardList, path: '/admin/moderation' },
  { id: 'audit', label: 'Audit Log', icon: ScrollText, path: '/admin/audit' },
  { id: 'flags', label: 'Feature Flags', icon: ToggleLeft, path: '/admin/flags' },
  { id: 'user-experience', label: 'User Experience', subtitle: 'Feedback & engagement tools', icon: MessagesSquare, path: '/admin/user-experience' },
  { id: 'system', label: 'System', icon: Server, path: '/admin/system' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
];

const SHORTCUT_TARGETS: Record<string, string> = {
  o: '/admin',
  u: '/admin/users',
  s: '/admin/sessions',
  l: '/admin/audit',
};

export function AdminDashboard({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { user, loading } = useSession();
  // The session is localStorage-cached (useSession initialData): the server
  // renders the guest view, so the first client render must agree or React 19
  // throws a hydration mismatch (and the subsequent client re-render trips
  // the head script-tag warning). Until hydration completes we show the same
  // "Loading console…" shell the server rendered, then the real console.
  const hydrated = useHydrated();
  const identityLoading = loading || !hydrated;
  const [signingOut, setSigningOut] = useState(false);

  const active = useMemo(() => {
    const match = NAV.find((n) => n.path === pathname);
    if (match) return match;
    // Unknown deep link or legacy slug → normalize (SSR-safe initialTab fallback).
    return NAV.find((n) => n.id === initialTab) ?? NAV[0]!;
  }, [pathname, initialTab]);

  // Keyboard shortcuts: G then O/U/S/L (ignored while typing).
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (pendingG) {
        pendingG = false;
        if (timer) clearTimeout(timer);
        const path = SHORTCUT_TARGETS[key];
        if (path) {
          event.preventDefault();
          router.push(path);
        }
      } else if (key === 'g') {
        pendingG = true;
        timer = setTimeout(() => {
          pendingG = false;
        }, 1_200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logoutAccount();
      invalidateIdentityCaches(queryClient);
      router.push('/');
    } catch {
      toast.error('Sign out failed — try again.');
      setSigningOut(false);
    }
  };

  if (identityLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="flex items-center gap-3 text-sm text-[#6b7280]">
          <span className="size-1.5 animate-pulse rounded-full bg-[#3b82f6]" aria-hidden />
          Loading console…
        </div>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-6">
        <div className="w-full max-w-sm rounded-lg border border-[#1f1f1f] bg-[#111111] p-8 text-center">
          <ShieldCheck className="mx-auto size-6 text-[#6b7280]" aria-hidden />
          <h1 className="pt-3 text-sm font-medium text-white">Restricted area</h1>
          <p className="pt-1 text-xs leading-relaxed text-[#9ca3af]">
            This console is only available to platform administrators.
          </p>
          <AdmButton variant="primary" className="mt-5 w-full" onClick={() => router.push('/')}>
            Back to CineDeck
          </AdmButton>
        </div>
      </div>
    );
  }

  const TabComponent = {
    overview: OverviewTab,
    users: UsersTab,
    sessions: SessionsTab,
    moderation: ModerationTab,
    audit: AuditTab,
    flags: FlagsTab,
    'user-experience': UxTab,
    system: SystemTab,
    settings: SettingsTab,
  }[active.id] ?? OverviewTab;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      {/* Sidebar — fixed, 220px, desktop only */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-[#1f1f1f] bg-[#0a0a0a] lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-[#1f1f1f] px-4">
          <span className="flex size-6 items-center justify-center rounded bg-[#3b82f6] font-mono text-[11px] font-bold text-white">C</span>
          <span className="text-sm font-semibold tracking-tight text-white">CineDeck</span>
          <span className="rounded border border-[#1f1f1f] px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#6b7280]">Admin</span>
        </div>
        <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const isActive = item.id === active.id;
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150',
                      isActive ? 'bg-[#141414] text-white' : 'text-[#9ca3af] hover:bg-[#111111] hover:text-white',
                    )}
                  >
                    {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#3b82f6]" aria-hidden />}
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-4">{item.label}</span>
                      {item.subtitle && <span className="block truncate pt-0.5 text-[10px] leading-3 text-[#6b7280]">{item.subtitle}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-[#1f1f1f] px-4 py-3">
          <p className="flex items-center gap-1.5 font-mono text-[10px] text-[#6b7280]">
            <Gauge className="size-3" aria-hidden />
            v2.4 · all systems normal
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-[220px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[#1f1f1f] bg-[#0a0a0a]/95 px-4 backdrop-blur sm:px-6">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="text-[#6b7280]">Admin</span>
            <span className="text-[#4b5563]" aria-hidden>/</span>
            <span className="truncate font-medium text-white">{active.label}</span>
          </nav>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <UpdatedAgo className="hidden sm:inline" />
            <div className="flex items-center gap-2 border-l border-[#1f1f1f] pl-3 sm:pl-4">
              <Avatar email={user.email} avatar={user.avatar} size={26} />
              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-[140px] truncate text-xs font-medium leading-4 text-white">{user.name || user.email}</span>
                <span className="block text-[10px] leading-3 text-[#6b7280]">Administrator</span>
              </span>
              <AdmButton variant="ghost" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" className="px-2">
                <LogOut className="size-4" aria-hidden />
              </AdmButton>
            </div>
          </div>
        </header>

        {/* Content — 100ms fade between tabs */}
        <main className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          <div key={active.id} className="adm-fade">
            <TabComponent />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav — icons only */}
      <nav
        aria-label="Admin sections"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-start gap-0.5 overflow-x-auto border-t border-[#1f1f1f] bg-[#0a0a0a] px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 lg:hidden"
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active.id;
          return (
            <Link
              key={item.id}
              href={item.path}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'flex min-w-[52px] flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-150',
                isActive ? 'text-white' : 'text-[#6b7280] hover:text-white',
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className={cn('h-0.5 w-4 rounded-full', isActive ? 'bg-[#3b82f6]' : 'bg-transparent')} aria-hidden />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
