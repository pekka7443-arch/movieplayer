'use client';

// Settings → Account / Security panels.
//  - AccountPanel: display name, emoji avatar picker, email change
//    (password-confirmed + re-verification), verification status.
//  - SecurityPanel: password change, 2FA (QR + backup codes), active
//    sessions with per-device revoke.
//  - AccountSecurity: both combined (legacy wrapper used by other callers).

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AtSign,
  BadgeCheck,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  KeyRound,
  MailCheck,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  ShieldOff,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  ACCOUNT_EXPORT_URL,
  AUTH_ERROR_TEXT,
  changePassword,
  changeEmail,
  deleteAccount,
  fetchSessions,
  resendVerification,
  revokeOtherSessions,
  totpDisable,
  totpEnable,
  totpSetup,
  updateProfile,
  type SessionInfo,
} from '@/lib/auth-client';
import { checkPassword } from '@/lib/password';
import { deviceLabel, timeAgo } from '@/lib/format';
import { useSession, invalidateIdentityCaches } from '@/hooks/use-session';

const AVATAR_PRESETS = ['🍿', '🎬', '🦁', '🐰', '🦊', '🐼', '🐙', '🦉', '🐧', '🌵', '🍄', '⚡'];

// ---------------------------------------------------------------------------
// ACCOUNT — identity (name / avatar / email)
// ---------------------------------------------------------------------------

export function AccountPanel() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [showEmailPassword, setShowEmailPassword] = useState(false);

  if (!user) return null;
  const displayName = nameDirty ? name : (user.name ?? '');
  const verified = user.emailVerified === true;

  const saveName = async () => {
    setSavingName(true);
    try {
      await updateProfile({ name: displayName.trim() || undefined });
      toast.success('Display name updated');
      invalidateIdentityCaches(queryClient);
      setNameDirty(false);
    } catch {
      toast.error('Could not update the name');
    } finally {
      setSavingName(false);
    }
  };

  const saveAvatar = async (avatar: string | null) => {
    setSavingAvatar(true);
    try {
      await updateProfile({ avatar });
      toast.success(avatar ? `Avatar set to ${avatar}` : 'Avatar removed');
      invalidateIdentityCaches(queryClient);
    } catch {
      toast.error('Could not update the avatar');
    } finally {
      setSavingAvatar(false);
    }
  };

  const onChangeEmail = async () => {
    setEmailBusy(true);
    try {
      const result = await changeEmail(emailPassword, newEmail.trim().toLowerCase());
      toast.success('Email updated', {
        description: result.verificationSent
          ? `A verification link was sent to ${result.email}.`
          : 'Check the new inbox to verify it.',
      });
      setEmailOpen(false);
      setEmailPassword('');
      setNewEmail('');
      invalidateIdentityCaches(queryClient);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: keyof typeof AUTH_ERROR_TEXT }).code : 'unknown';
      toast.error(AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown);
    } finally {
      setEmailBusy(false);
    }
  };

  const onResend = async () => {
    try {
      await resendVerification(user.email);
      toast.success('Verification link sent', {
        description: 'Console mail adapter? The link is in the server log.',
      });
    } catch {
      toast.error('Could not send the link');
    }
  };

  return (
    <section aria-labelledby="settings-account-identity" className="space-y-4">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-brand" aria-hidden />
        <Label className="text-sm font-medium" id="settings-account-identity">
          Profile
        </Label>
      </div>

      {/* Name */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Display name</p>
        <div className="flex gap-2">
          <Input
            value={displayName}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            placeholder={user.email.split('@')[0]}
            maxLength={40}
            className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
          />
          <Button
            type="button"
            size="sm"
            disabled={!nameDirty || savingName || displayName.trim().length === 0}
            onClick={saveName}
            className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
          >
            {savingName ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Save'}
          </Button>
        </div>
      </div>

      {/* Avatar */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Avatar</p>
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_PRESETS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Set avatar ${emoji}`}
              aria-pressed={user.avatar === emoji}
              disabled={savingAvatar}
              onClick={() => saveAvatar(emoji)}
              className={`flex size-9 items-center justify-center rounded-xl border text-lg transition-transform hover:scale-110 ${
                user.avatar === emoji
                  ? 'border-brand bg-brand/15'
                  : 'border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/60'
              }`}
            >
              {emoji}
            </button>
          ))}
          {user.avatar && (
            <button
              type="button"
              aria-label="Remove avatar"
              onClick={() => saveAvatar(null)}
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 dark:border-zinc-800"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <AtSign className="size-3.5 text-brand" aria-hidden />
            Email
          </p>
          {verified ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <BadgeCheck className="size-3.5" aria-hidden /> verified
            </span>
          ) : (
            <button
              type="button"
              onClick={onResend}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand underline-offset-2 hover:underline"
            >
              <MailCheck className="size-3.5" aria-hidden /> verify now
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-300">{user.email}</p>
        {!emailOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEmailOpen(true)}
            className="h-7 rounded-lg border-zinc-200 px-2 text-[11px] dark:border-zinc-800"
          >
            Change email
          </Button>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="relative">
              <Input
                type={showEmailPassword ? 'text' : 'password'}
                placeholder="Current password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                autoComplete="current-password"
                className="h-9 rounded-lg border-zinc-200 bg-white/80 pr-9 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
              />
              <button
                type="button"
                aria-label={showEmailPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowEmailPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                {showEmailPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Input
              type="email"
              placeholder="New email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
              className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={emailBusy || !emailPassword || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail)}
                onClick={onChangeEmail}
                className="h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
              >
                {emailBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Update email'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEmailOpen(false);
                  setEmailPassword('');
                  setNewEmail('');
                }}
                className="h-8 rounded-lg border-zinc-200 text-xs dark:border-zinc-800"
              >
                Cancel
              </Button>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              The change applies immediately and the account goes back to unverified until you
              confirm the new address.
            </p>
          </div>
        )}
      </div>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// SECURITY — password / 2FA / sessions
// ---------------------------------------------------------------------------

export function SecurityPanel() {
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
  const [totpSetupState, setTotpSetupState] = useState<{ secret: string; qrDataUrl?: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

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
      void queryClient.invalidateQueries({ queryKey: ['session'] });
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

  const onRevokeOne = async (id: string) => {
    const res = await fetch('/api/auth/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      toast.success('Device signed out');
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } else {
      toast.error('Could not sign out that device');
    }
  };

  const onStartTotp = async () => {
    setTotpBusy(true);
    try {
      const setup = await totpSetup();
      setTotpSetupState({ secret: setup.secret, qrDataUrl: setup.qrDataUrl });
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
      const result = await totpEnable(totpCode);
      toast.success('Two-factor authentication enabled', {
        description: 'Save your backup codes somewhere safe.',
      });
      setBackupCodes(result.backupCodes ?? null);
      setTotpSetupState(null);
      setTotpCode('');
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch {
      toast.error(AUTH_ERROR_TEXT.invalid_code);
    } finally {
      setTotpBusy(false);
    }
  };

  const onDisableTotp = async () => {
    if (totpCode.length < 6) return;
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
    <section aria-labelledby="settings-security" className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" aria-hidden />
        <Label className="text-sm font-medium" id="settings-security">
          Security
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
          placeholder="New password (8+ chars, number & symbol)"
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
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
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
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {user.totpEnabled ? 'On' : 'Off'}
            </span>
            <Switch
              checked={user.totpEnabled === true}
              onCheckedChange={(checked) => {
                if (checked) {
                  void onStartTotp();
                } else {
                  setTotpSetupState({ secret: 'disable-pending' });
                }
              }}
              disabled={totpBusy}
              aria-label="Two-factor authentication"
              className="data-[state=checked]:bg-brand"
            />
          </div>
        </div>

        {/* Disable flow */}
        {totpSetupState?.secret === 'disable-pending' && (
          <div className="space-y-2">
            <Input
              inputMode="numeric"
              placeholder="Code or backup code to turn 2FA off"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/[^\dA-Za-z-]/g, '').slice(0, 9))}
              className="h-9 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={totpBusy || totpCode.length < 6}
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
                  setTotpSetupState(null);
                  setTotpCode('');
                }}
                className="h-8 rounded-lg border-zinc-200 text-xs dark:border-zinc-800"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Setup flow: QR + secret + confirm code */}
        {totpSetupState && totpSetupState.secret !== 'disable-pending' && (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              1. Scan the QR code with your authenticator app (Google Authenticator, Aegis,
              1Password…) — or paste the key manually.
            </p>
            {totpSetupState.qrDataUrl && (
              <div className="flex justify-center rounded-lg bg-white p-2 dark:bg-zinc-200">
                <img src={totpSetupState.qrDataUrl} alt="2FA QR code" width={160} height={160} className="size-40" />
              </div>
            )}
            <code className="block break-all rounded-lg bg-zinc-100 px-2.5 py-2 text-center font-mono text-xs font-semibold text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {totpSetupState.secret}
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

        {/* Backup codes — shown exactly once after enabling */}
        {backupCodes && (
          <div className="space-y-1.5 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Backup codes — each works once, shown only now:
            </p>
            <div className="grid grid-cols-2 gap-1">
              {backupCodes.map((code) => (
                <code key={code} className="rounded bg-white/80 px-2 py-1 text-center font-mono text-xs dark:bg-zinc-900/80">
                  {code}
                </code>
              ))}
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Lost phone? Use a backup code at sign-in instead of the 6-digit code.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setBackupCodes(null)}
              className="h-7 rounded-lg border-amber-400/50 text-[11px]"
            >
              I saved them
            </Button>
          </div>
        )}

        {!totpSetupState && !backupCodes && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Adds a 6-digit code from your authenticator app on top of your password. Backup codes
            are issued when you enable it.
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
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No active sessions.</p>
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
                  {session.city && (
                    <span className="ml-1.5 text-[10px] text-zinc-400">
                      {session.city}
                    </span>
                  )}
                </span>
                {!session.current && (
                  <button
                    type="button"
                    aria-label={`Sign out ${deviceLabel(session.userAgent)}`}
                    onClick={() => onRevokeOne(session.id)}
                    className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
                <span className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                  {timeAgo(session.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Sessions stay alive for 30 days and quietly renew while you use CineDeck.
        </p>
      </div>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />
    </section>
  );
}

/** Legacy combined wrapper (Account + Security). */
export function AccountSecurity() {
  return (
    <>
      <AccountPanel />
      <SecurityPanel />
    </>
  );
}

/** Danger-zone pieces: data export + account deletion. */
export function DangerZonePanel() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const onDelete = async () => {
    if (confirmText !== 'DELETE') {
      toast.error('Type DELETE exactly to confirm.');
      return;
    }
    setBusy(true);
    try {
      await deleteAccount(password);
      toast.success('Account deleted', {
        description: '30-day grace period started — sign in again to reactivate.',
      });
      invalidateIdentityCaches(queryClient);
      window.setTimeout(() => {
        window.location.replace('/');
      }, 600);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as { code: keyof typeof AUTH_ERROR_TEXT }).code : 'unknown';
      toast.error(AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="settings-danger-account" className="space-y-3">
      <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Download my data</p>
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          A machine-readable JSON export of your profile, watchlist, history, ratings, lists and
          comments. Credentials and IPs are never included.
        </p>
        <Button asChild size="sm" variant="outline" className="h-8 rounded-lg border-zinc-200 text-xs dark:border-zinc-800">
          <a href={ACCOUNT_EXPORT_URL} download>
            <EyeOff className="mr-1.5 size-3.5" aria-hidden />
            Export JSON
          </a>
        </Button>
      </div>

      <div className="space-y-2 rounded-xl border border-red-300/60 bg-red-50/50 p-3 dark:border-red-900/50 dark:bg-red-950/20">
        <p className="text-xs font-semibold text-red-700 dark:text-red-300">Delete my account</p>
        <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Soft delete with a 30-day grace period: sign in again within 30 days to reactivate.
          After that everything is permanently removed.
        </p>
        <Input
          type="password"
          placeholder="Confirm with your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
        />
        <Input
          placeholder="Type DELETE to confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="h-9 rounded-lg border-zinc-200 bg-white/80 text-sm dark:border-zinc-800 dark:bg-zinc-900/70"
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy || !password || confirmText !== 'DELETE'}
          onClick={onDelete}
          className="h-8 rounded-lg text-xs font-semibold"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Delete account'}
        </Button>
      </div>
    </section>
  );
}
