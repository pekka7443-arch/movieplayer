'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  LogOut,
  KeyRound,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  ShieldOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  AUTH_ERROR_TEXT,
  changePassword,
  fetchSessions,
  revokeOtherSessions,
  totpDisable,
  totpEnable,
  totpSetup,
  type SessionInfo,
} from '@/lib/auth-client';
import { checkPassword } from '@/lib/password';
import { useSession } from '@/hooks/use-session';

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone / iPad';
  if (/android/i.test(userAgent)) return 'Android device';
  if (/macintosh/i.test(userAgent)) return 'Mac';
  if (/windows/i.test(userAgent)) return 'Windows PC';
  if (/linux/i.test(userAgent)) return 'Linux device';
  return 'Browser';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Account & security panel — shown inside Settings when signed in. */
export function AccountSecurity() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery<SessionInfo[]>({
    queryKey: ['auth', 'sessions'],
    queryFn: fetchSessions,
    staleTime: 30_000,
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  if (!user) return null;

  const onChangePassword = async () => {
    if (passwordBusy) return;
    const verdict = checkPassword(newPassword);
    if (!verdict.acceptable) {
      toast.error(verdict.problems[0] ?? 'That password is too weak');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password changed', {
        description: 'Other devices were signed out — this one stays signed in.',
      });
      setCurrentPassword('');
      setNewPassword('');
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: keyof typeof AUTH_ERROR_TEXT }).code : 'unknown';
      toast.error(AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown);
    } finally {
      setPasswordBusy(false);
    }
  };

  const onRevokeOthers = async () => {
    const revoked = await revokeOtherSessions();
    toast.success(revoked > 0 ? `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}` : 'No other devices signed in');
    void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
  };

  const onStartTotp = async () => {
    setTotpBusy(true);
    try {
      const { secret } = await totpSetup();
      setTotpSecret(secret);
    } catch {
      toast.error('Could not start 2FA setup');
    } finally {
      setTotpBusy(false);
    }
  };

  const onEnableTotp = async () => {
    if (totpCode.length !== 6) return;
    setTotpBusy(true);
    try {
      await totpEnable(totpCode);
      toast.success('Two-factor authentication enabled', {
        description: 'You’ll be asked for a code at every sign-in from now on.',
      });
      setTotpSecret(null);
      setTotpCode('');
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch {
      toast.error(AUTH_ERROR_TEXT.invalid_code);
    } finally {
      setTotpBusy(false);
    }
  };

  const onDisableTotp = async () => {
    if (totpCode.length !== 6) return;
    setTotpBusy(true);
    try {
      await totpDisable(totpCode);
      toast.success('Two-factor authentication disabled');
      setTotpCode('');
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch {
      toast.error(AUTH_ERROR_TEXT.invalid_code);
    } finally {
      setTotpBusy(false);
    }
  };

  const sessions = sessionsQuery.data ?? [];

  return (
    <section aria-labelledby="settings-account" className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" aria-hidden />
        <Label className="text-sm font-medium" id="settings-account">
          Account &amp; security
        </Label>
      </div>

      {/* Change password */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <KeyRound className="size-3.5 text-brand" aria-hidden />
          Change password
        </p>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="New password (8+ chars, letters + digits)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
        />
        <Button
          type="button"
          size="sm"
          disabled={passwordBusy || !currentPassword || !newPassword}
          onClick={onChangePassword}
          className="h-8 rounded-lg bg-brand text-xs font-semibold text-brand-foreground hover:bg-brand/90"
        >
          {passwordBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Update password'}
        </Button>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-600">
          Changing the password signs out every other device.
        </p>
      </div>

      {/* Two-factor */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Smartphone className="size-3.5 text-brand" aria-hidden />
            Two-factor authentication
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
              {user.totpEnabled ? 'On' : 'Off'}
            </span>
            <Switch
              checked={user.totpEnabled === true}
              onCheckedChange={(checked) => {
                if (checked) {
                  void onStartTotp();
                } else {
                  setTotpSecret('disable-pending');
                }
              }}
              disabled={totpBusy}
              aria-label="Two-factor authentication"
              className="data-[state=checked]:bg-brand"
            />
          </div>
        </div>

        {totpSecret === 'disable-pending' && (
          <div className="space-y-2">
            <Input
              inputMode="numeric"
              placeholder="Enter a current code to turn 2FA off"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-9 rounded-lg border-zinc-200 bg-white/80 text-center font-mono tracking-widest text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={totpBusy || totpCode.length !== 6}
                onClick={onDisableTotp}
                className="h-8 rounded-lg bg-red-500 text-xs font-semibold text-white hover:bg-red-400"
              >
                <ShieldOff className="size-3.5" aria-hidden />
                Disable 2FA
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setTotpSecret(null);
                  setTotpCode('');
                }}
                className="h-8 rounded-lg border-zinc-200 text-xs dark:border-zinc-800"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {totpSecret && totpSecret !== 'disable-pending' && (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              1. Add a new account in your authenticator app (Google Authenticator, Aegis,
              1Password…) and paste this key:
            </p>
            <code className="block break-all rounded-lg bg-zinc-100 px-2.5 py-2 font-mono text-xs font-semibold text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {totpSecret}
            </code>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              2. Enter the 6-digit code it shows to confirm.
            </p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-9 rounded-lg border-zinc-200 bg-white/80 text-center font-mono tracking-widest text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
            />
            <Button
              type="button"
              size="sm"
              disabled={totpBusy || totpCode.length !== 6}
              onClick={onEnableTotp}
              className="h-8 rounded-lg bg-brand text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              {totpBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Verify & enable'}
            </Button>
          </div>
        )}

        {!totpSecret && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-600">
            Adds a 6-digit code from your authenticator app on top of your password.
          </p>
        )}
      </div>

      {/* Devices */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <MonitorSmartphone className="size-3.5 text-brand" aria-hidden />
            Devices
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRevokeOthers}
            className="h-7 gap-1 rounded-lg border-zinc-200 px-2 text-[11px] dark:border-zinc-800"
          >
            <LogOut className="size-3" aria-hidden />
            Log out other devices
          </Button>
        </div>
        {sessionsQuery.isPending ? (
          <Loader2 className="size-4 animate-spin text-zinc-400" aria-label="Loading devices" />
        ) : sessions.length === 0 ? (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-600">No active sessions.</p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100/70 px-2.5 py-1.5 text-xs dark:bg-zinc-900/60"
              >
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                  {deviceLabel(session.userAgent)}
                  {session.current && (
                    <span className="ml-1.5 rounded bg-brand/15 px-1 py-0.5 text-[10px] font-semibold text-brand">
                      this device
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-500">
                  {timeAgo(session.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-zinc-500 dark:text-zinc-600">
          Sessions stay alive for 30 days and quietly renew while you use CineDeck.
        </p>
      </div>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />
    </section>
  );
}
