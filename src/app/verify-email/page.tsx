'use client';

// Standalone email-verification page — target of the emailed verification
// link (/verify-email?token=…). Confirms the token via POST /api/auth/verify
// exactly once, then shows a permanent success / failure screen.

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clapperboard, Loader2, MailCheck, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Status = 'working' | 'ok' | 'fail';

function VerifyRunner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>(token ? 'working' : 'fail');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('bad');
        setStatus('ok');
      })
      .catch(() => setStatus('fail'));
  }, [token]);

  if (status === 'working') {
    return (
      <div className="space-y-3 py-6 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-brand" aria-hidden />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Confirming your email…</p>
      </div>
    );
  }

  if (status === 'ok') {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-12 text-emerald-500" aria-hidden />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Email verified</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your address is confirmed. Everything is synced to your account from here on.
        </p>
        <Button asChild className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 hover:bg-brand/90">
          <Link href="/">Start watching</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <XCircle className="mx-auto size-12 text-red-500" aria-hidden />
      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Link not valid</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This verification link is missing, expired or already used. You can send a new one from
        Settings → Account while signed in.
      </p>
      <Button asChild variant="outline" className="h-11 w-full rounded-lg text-sm font-semibold">
        <Link href="/">Back to CineDeck</Link>
      </Button>
    </div>
  );
}

// Prerender is unnecessary for a token-driven client page.
export const dynamic = 'force-dynamic';

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-md">
            <CheckCircle2 className="size-5.5" aria-hidden />
          </span>
          <div className="pt-4 text-center">
            <span className="mb-4 inline-flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              <Clapperboard className="size-4" aria-hidden /> CineDeck
            </span>
          </div>
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <Loader2 className="size-6 animate-spin text-brand" aria-hidden />
              </div>
            }
          >
            <VerifyRunner />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
