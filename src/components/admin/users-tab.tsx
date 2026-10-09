'use client';

// Users — clean data table with sticky header, instant search, subtle filter
// pills, three-dot row actions and a 400px slide-in detail drawer.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, MoreHorizontal, RefreshCw, SearchX, ShieldOff, ShieldX } from 'lucide-react';

import {
  adminAction,
  adminGet,
  AdmButton,
  AdmSelect,
  Avatar,
  fmtDate,
  PageHeader,
  Pagination,
  SearchInput,
  Section,
  SortTh,
  StatusDot,
  useRefreshPing,
} from '@/components/admin/ui';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { timeAgo } from '@/lib/format';

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatar: string | null;
  createdAt: string;
  country: string | null;
  city: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  suspensionEndsAt: string | null;
  deletedAt: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  signupIp: string | null;
  watchCount: number;
  watchlistSize: number;
  commentCount: number;
  ratingCount: number;
  sessionCount: number;
  lastSeenAt: string | null;
}

type RowStatus = 'active' | 'suspended' | 'deleted' | 'admin';

function rowStatus(u: AdminUserRow): RowStatus {
  if (u.deletedAt) return 'deleted';
  if (u.suspendedAt) return 'suspended';
  if (u.role === 'admin') return 'admin';
  return 'active';
}

export function UsersTab() {
  const queryClient = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [detailId, setDetailId] = useState<string | null>(null);

  // Instant-as-you-type search, debounced so the API isn't hammered.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [qInput]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ view: 'users', sort: 'createdAt', dir: 'desc', page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (role) p.set('role', role);
    if (verified) p.set('verified', verified);
    return p.toString();
  }, [q, status, role, verified, page]);

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'users', qs],
    queryFn: () =>
      adminGet<{ total: number; page: number; pageSize: number; pages?: number; users: AdminUserRow[] }>(
        `/api/admin?${qs}`,
      ),
    refetchInterval: 60_000,
  });
  useRefreshPing(dataUpdatedAt);

  const onSort = (col: string) => {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(col);
      setDir('desc');
    }
  };

  const rows = useMemo(() => {
    const list = data?.users ? [...data.users] : [];
    if (sort === 'createdAt') return list; // server already sorted
    list.sort((a, b) => {
      const va = (sort === 'name' ? a.name || a.email : sort === 'lastSeen' ? a.lastSeenAt ?? '' : a[sort as 'email'] ?? '') as string;
      const vb = (sort === 'name' ? b.name || b.email : sort === 'lastSeen' ? b.lastSeenAt ?? '' : b[sort as 'email'] ?? '') as string;
      const cmp = va.localeCompare(vb, undefined, { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data, sort, dir]);

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  };

  const suspend = (u: AdminUserRow) => {
    const reason = window.prompt(`Suspension reason for ${u.email} (shown to the user):`);
    if (reason && reason.trim().length >= 3) void run({ action: 'suspendUser', id: u.id, reason: reason.trim() }, `${u.email} suspended`);
  };

  const csvHref = `/api/admin?view=users&format=csv${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${role ? `&role=${role}` : ''}`;

  return (
    <div>
      <PageHeader
        title="Users"
        description="Every account on the platform — search, filter and manage access."
        actions={
          <>
            <a href={csvHref} download aria-label="Export users as CSV">
              <AdmButton variant="ghost">
                <Download className="size-3.5" aria-hidden /> Export CSV
              </AdmButton>
            </a>
            <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh users">
              <RefreshCw className="size-3.5" aria-hidden /> Refresh
            </AdmButton>
          </>
        }
      />

      {/* Search + subtle filter pills */}
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search users"
          className="w-full sm:w-72"
        />
        <AdmSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </AdmSelect>
        <AdmSelect value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </AdmSelect>
        <AdmSelect value={verified} onChange={(e) => { setVerified(e.target.value); setPage(1); }} aria-label="Filter by verification">
          <option value="">Verified & unverified</option>
          <option value="yes">Verified</option>
          <option value="no">Unverified</option>
        </AdmSelect>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#111111]">
        <div className="max-h-[calc(100vh-320px)] overflow-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[#111111]">
              <tr className="border-b border-[#1f1f1f]">
                <SortTh col="name" sort={sort} dir={dir} onSort={onSort}>User</SortTh>
                <SortTh col="email" sort={sort} dir={dir} onSort={onSort}>Email</SortTh>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Country</th>
                <SortTh col="createdAt" sort={sort} dir={dir} onSort={onSort}>Joined</SortTh>
                <SortTh col="lastSeen" sort={sort} dir={dir} onSort={onSort}>Last seen</SortTh>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-[#6b7280]">Loading…</td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <SearchX className="mx-auto size-5 text-[#4b5563]" aria-hidden />
                    <p className="pt-2 text-xs text-[#9ca3af]">No users match the current filters.</p>
                  </td>
                </tr>
              )}
              {rows.map((u, i) => (
                <tr
                  key={u.id}
                  onClick={() => setDetailId(u.id)}
                  className={`cursor-pointer border-b border-[#1f1f1f] transition-colors duration-150 hover:bg-[#161616] ${i % 2 === 1 ? 'bg-[#0d0d0d]' : 'bg-[#111111]'}`}
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar email={u.email} avatar={u.avatar} size={26} />
                      <span className="max-w-[160px] truncate text-[13px] text-white">{u.name || u.email.split('@')[0]}</span>
                    </span>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs text-[#9ca3af]">{u.email}</td>
                  <td className="px-4 py-2.5"><StatusDot status={rowStatus(u)} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs uppercase text-[#9ca3af]">{u.country ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#9ca3af]">{fmtDate(u.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#9ca3af]">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : '—'}</td>
                  <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <AdmButton variant="ghost" aria-label={`Row actions for ${u.email}`} className="px-1.5">
                          <MoreHorizontal className="size-4" aria-hidden />
                        </AdmButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-[#1f1f1f] bg-[#111111] text-zinc-200">
                        {u.suspendedAt ? (
                          <DropdownMenuItem
                            aria-label={`Unsuspend ${u.email}`}
                            onClick={() => void run({ action: 'unsuspendUser', id: u.id }, `${u.email} reinstated`)}
                          >
                            <ShieldOff className="size-3.5" aria-hidden /> Unsuspend
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            aria-label={`Suspend ${u.email}`}
                            onClick={() => suspend(u)}
                            disabled={Boolean(u.deletedAt)}
                          >
                            <ShieldX className="size-3.5" aria-hidden /> Suspend
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => void run({ action: 'forceLogout', id: u.id }, `Sessions revoked for ${u.email}`)}>
                          Revoke sessions
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void run({ action: 'sendPasswordReset', id: u.id }, 'Password reset email sent')}>
                          Send password reset
                        </DropdownMenuItem>
                        {!u.emailVerified && (
                          <DropdownMenuItem onClick={() => void run({ action: 'verifyEmail', id: u.id }, 'Email marked verified')}>
                            Mark email verified
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-[#1f1f1f]" />
                        {u.role === 'admin' ? (
                          <DropdownMenuItem onClick={() => void run({ action: 'promoteUser', id: u.id, admin: false }, `${u.email} demoted to user`)}>
                            Demote to user
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void run({ action: 'promoteUser', id: u.id, admin: true }, `${u.email} promoted to admin`)}>
                            Promote to admin
                          </DropdownMenuItem>
                        )}
                        {u.deletedAt ? (
                          <DropdownMenuItem onClick={() => void run({ action: 'reactivateUser', id: u.id }, `${u.email} reactivated`)}>
                            Reactivate account
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void run({ action: 'softDeleteUser', id: u.id }, `${u.email} scheduled for deletion`)} className="text-[#ef4444]">
                            Delete account
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="border-t border-[#1f1f1f] px-4 py-3">
            <Pagination
              page={data.page}
              pages={data.pages ?? Math.max(1, Math.ceil(data.total / (data.pageSize || 25)))}
              total={data.total}
              onPage={setPage}
              label="users"
            />
          </div>
        )}
      </div>

      <UserDrawer userId={detailId} onClose={() => setDetailId(null)} onAction={run} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer — 400px, sections separated by thin lines.
// ---------------------------------------------------------------------------

interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    avatar: string | null;
    createdAt: string;
    updatedAt: string;
    emailVerified: string | null;
    totpEnabled: boolean;
    mustChangePassword: boolean;
    signupIp: string | null;
    country: string | null;
    city: string | null;
    suspendedAt: string | null;
    suspensionReason: string | null;
    suspensionEndsAt: string | null;
    deletedAt: string | null;
    watchCount: number;
  };
  loginHistory: { id: string; success: boolean; reason: string | null; ip: string | null; country: string | null; createdAt: string }[];
  loginTotal: number;
  loginPages: number;
  historyPage: number;
  sessions: { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; country: string | null }[];
  activity: {
    history: { id: string; title: string; updatedAt: string }[];
    watchlistCount: number;
    ratingCount: number;
    avgScore: number | null;
    lists: number;
    comments: { id: string; body: string; status: string; createdAt: string }[];
    reports: { id: string; reason: string | null; createdAt: string; comment: { id: string; body: string } }[];
  };
  notes: { id: string; authorEmail: string; body: string; createdAt: string }[];
}

function DrawerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-[#6b7280]">{label}</span>
      <span className="min-w-0 truncate text-right text-xs text-[#d1d5db]">{children}</span>
    </div>
  );
}

function UserDrawer({ userId, onClose, onAction }: {
  userId: string | null;
  onClose: () => void;
  onAction: (body: Record<string, unknown>, okMessage: string) => Promise<void>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => adminGet<UserDetail>(`/api/admin?view=user&id=${encodeURIComponent(userId!)}`),
    enabled: Boolean(userId),
  });

  const [note, setNote] = useState('');
  const u = data?.user;

  return (
    <Sheet open={Boolean(userId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[400px] overflow-y-auto border-l border-[#1f1f1f] bg-[#0d0d0d] p-0 sm:max-w-[400px]">
        {isLoading || !u ? (
          <div className="p-6 text-xs text-[#6b7280]">Loading…</div>
        ) : (
          <div className="text-left">
            {/* Identity */}
            <div className="flex items-start gap-3 border-b border-[#1f1f1f] px-6 py-6">
              <Avatar email={u.email} avatar={u.avatar} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{u.name || u.email.split('@')[0]}</p>
                <p className="truncate pt-0.5 font-mono text-xs text-[#9ca3af]">{u.email}</p>
                <div className="pt-2"><StatusDot status={u.deletedAt ? 'deleted' : u.suspendedAt ? 'suspended' : u.role === 'admin' ? 'admin' : 'active'} /></div>
              </div>
            </div>

            {/* Profile */}
            <div className="border-b border-[#1f1f1f] px-6 py-4">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Profile</p>
              <DrawerRow label="Joined">{fmtDate(u.createdAt)}</DrawerRow>
              <DrawerRow label="Email verified">{u.emailVerified ? 'Yes' : 'No'}</DrawerRow>
              <DrawerRow label="Two-factor">{u.totpEnabled ? 'Enabled' : 'Off'}</DrawerRow>
              <DrawerRow label="Location">{[u.city, u.country].filter(Boolean).join(', ') || '—'}</DrawerRow>
              <DrawerRow label="Signup IP"><span className="font-mono">{u.signupIp ?? '—'}</span></DrawerRow>
              {u.suspendedAt && (
                <DrawerRow label="Suspension">{u.suspensionReason ?? 'No reason recorded'}</DrawerRow>
              )}
            </div>

            {/* Activity */}
            <div className="border-b border-[#1f1f1f] px-6 py-4">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Activity</p>
              <div className="grid grid-cols-4 gap-2 py-2 text-center">
                {[
                  { label: 'Watches', value: u.watchCount },
                  { label: 'Watchlist', value: data.activity.watchlistCount },
                  { label: 'Ratings', value: data.activity.ratingCount },
                  { label: 'Lists', value: data.activity.lists },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-[#1f1f1f] bg-[#111111] px-1 py-2.5">
                    <p className="font-mono text-base font-semibold text-white">{s.value}</p>
                    <p className="pt-0.5 text-[10px] text-[#6b7280]">{s.label}</p>
                  </div>
                ))}
              </div>
              {data.activity.history.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {data.activity.history.slice(0, 5).map((h) => (
                    <li key={h.id} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-[#d1d5db]">{h.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-[#6b7280]">{timeAgo(h.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Login history */}
            <div className="border-b border-[#1f1f1f] px-6 py-4">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Login history (90d)</p>
              <ul className="divide-y divide-[#1f1f1f]">
                {data.loginHistory.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className={`size-1.5 shrink-0 rounded-full ${l.success ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-[#9ca3af]">{l.ip ?? 'unknown ip'}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[#6b7280]">{fmtDate(l.createdAt)}</span>
                  </li>
                ))}
                {data.loginHistory.length === 0 && <li className="py-2 text-xs text-[#6b7280]">No attempts recorded.</li>}
              </ul>
            </div>

            {/* Notes */}
            <div className="border-b border-[#1f1f1f] px-6 py-4">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Internal notes</p>
              <ul className="space-y-1.5 py-1">
                {data.notes.slice(0, 5).map((n) => (
                  <li key={n.id} className="rounded-lg border border-[#1f1f1f] bg-[#111111] px-3 py-2">
                    <p className="text-xs leading-relaxed text-[#d1d5db]">{n.body}</p>
                    <p className="pt-1 font-mono text-[10px] text-[#6b7280]">{n.authorEmail} · {fmtDate(n.createdAt)}</p>
                  </li>
                ))}
                {data.notes.length === 0 && <li className="py-1 text-xs text-[#6b7280]">No notes yet.</li>}
              </ul>
              <div className="flex gap-2 pt-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add an internal note…"
                  maxLength={1000}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 text-xs text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
                  aria-label="New internal note"
                />
                <AdmButton
                  variant="primary"
                  disabled={note.trim().length < 2}
                  onClick={async () => {
                    await onAction({ action: 'addNote', id: u.id, body: note.trim() }, 'Note added');
                    setNote('');
                  }}
                >
                  Save
                </AdmButton>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4">
              <p className="pb-2 text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Actions</p>
              <div className="flex flex-wrap gap-2">
                {u.suspendedAt ? (
                  <AdmButton onClick={() => void onAction({ action: 'unsuspendUser', id: u.id }, 'Account reinstated')}>Unsuspend</AdmButton>
                ) : (
                  <AdmButton
                    onClick={() => {
                      const reason = window.prompt('Suspension reason (shown to the user):');
                      if (reason && reason.trim().length >= 3) void onAction({ action: 'suspendUser', id: u.id, reason: reason.trim() }, 'Account suspended');
                    }}
                  >
                    Suspend
                  </AdmButton>
                )}
                <AdmButton onClick={() => void onAction({ action: 'forceLogout', id: u.id }, 'All sessions revoked')}>Revoke sessions</AdmButton>
                <AdmButton onClick={() => void onAction({ action: 'sendPasswordReset', id: u.id }, 'Password reset email sent')}>Password reset</AdmButton>
                {!u.emailVerified && (
                  <AdmButton onClick={() => void onAction({ action: 'verifyEmail', id: u.id }, 'Email marked verified')}>Verify email</AdmButton>
                )}
                <AdmButton
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`Delete ${u.email}? The account enters a 30-day grace period.`)) {
                      void onAction({ action: 'softDeleteUser', id: u.id }, 'Account scheduled for deletion');
                    }
                  }}
                >
                  Delete account
                </AdmButton>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
