'use client';

// Standalone password-reset page — the target of the emailed reset link
// (/reset-password?token=…). Deliberately outside the main app shell so it
// loads fast and works even when the SPA state is cold.

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clapperboard, Eye, EyeOff, Loader2, Lock, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { submitPasswordReset, type AuthError } from '@/lib/auth-client';
import { checkPassword } from '@/lib/password';

const STRENGTH_COLORS = ['bg-zinc-300 dark:bg-zinc-700', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400'];

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  const strength = useMemo(() => checkPassword(password), [password]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    const verdict = checkPassword(password);
    if (!verdict.acceptable) {
      setError(verdict.problems[0] ?? 'That password is too weak.');
      return;
    }
    setSubmitting(true);
    try {
      await submitPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      const code = (err as AuthError)?.code;
      if (code === 'invalid_token') setExpired(true);
      setError((err as AuthError)?.message ?? 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-500" aria-hidden />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Password updated</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your password has been changed. Use it to sign in from any device.
        </p>
        <Button asChild className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 hover:bg-brand/90">
          <Link href="/">Go to CineDeck and sign in</Link>
        </Button>
      </div>
    );
  }

  if (expired || !token) {
    return (
      <div className="space-y-4 text-center">
        <XCircle className="mx-auto size-12 text-red-500" aria-hidden />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Link not valid</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This reset link is missing, expired or already used. Request a fresh one from the sign-in
          dialog — it takes seconds.
        </p>
        <Button asChild variant="outline" className="h-11 w-full rounded-lg text-sm font-semibold">
          <Link href="/">Back to CineDeck</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="reset-password" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          New password
        </Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            id="reset-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="h-11 rounded-lg border-zinc-200 bg-white/80 pl-10 pr-10 text-sm dark:border-zinc-800 dark:bg-zinc-950/60"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {password.length > 0 && (
          <div className="space-y-1" aria-live="polite">
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i < strength.score ? STRENGTH_COLORS[strength.score] : STRENGTH_COLORS[0]
                  }`}
                />
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Strength: {strength.label}
              {strength.problems.length > 0 ? ` — ${strength.problems[0]}` : ''}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reset-confirm" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Confirm new password
        </Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            id="reset-confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat the new password"
            className="h-11 rounded-lg border-zinc-200 bg-white/80 pl-10 text-sm dark:border-zinc-800 dark:bg-zinc-950/60"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting}
        className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 hover:bg-brand/90"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden /> Updating…
          </>
        ) : (
          'Set new password'
        )}
      </Button>
    </form>
  );
}

// Prerender is unnecessary for a token-driven client page.
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  useEffect(() => {
    document.title = 'Reset password — CineDeck';
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-6 pb-5 pt-6 dark:border-zinc-800">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-md">
              <Clapperboard className="size-5.5" aria-hidden />
            </span>
            <h1 className="pt-3 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Choose a new password
            </h1>
            <p className="pt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Pick something strong — at least 8 characters with a number and a special character.
            </p>
          </div>
          <div className="px-6 py-6">
            <Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-zinc-400" aria-hidden />
                </div>
              }
            >
              <ResetForm />
            </Suspense>
          </div>
        </div>
        <p className="pt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/" className="underline-offset-4 hover:underline">
            ← Back to CineDeck
          </Link>
        </p>
      </div>
    </main>
  );
}
