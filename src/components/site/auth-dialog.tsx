'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Lock,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  adoptAuthenticatedUser,
  AUTH_ERROR_TEXT,
  AuthError,
  isTotpPending,
  loginAccount,
  registerAccount,
  requestPasswordReset,
  verifyTotpLogin,
} from '@/lib/auth-client';
import { checkPassword } from '@/lib/password';
import { invalidateIdentityCaches } from '@/hooks/use-session';
import { useCinedeckStore } from '@/lib/store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

type Step = 'form' | 'totp' | 'forgot' | 'forgot-done' | 'verify-email';

const STRENGTH_COLORS = ['bg-zinc-300 dark:bg-zinc-700', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400'];

type Tab = 'signin' | 'signup' | 'forgot';

/** Sign in / create account / reset dialog — shared by the header CTA and
 *  the "Sign in to watch" gate. */
export function AuthDialog() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const authOpen = useCinedeckStore((s) => s.authOpen);
  const authMode = useCinedeckStore((s) => s.authMode);
  const authNotice = useCinedeckStore((s) => s.authNotice);
  const authReturnTo = useCinedeckStore((s) => s.authReturnTo);
  const closeAuth = useCinedeckStore((s) => s.closeAuth);
  const openAuth = useCinedeckStore((s) => s.openAuth);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignup = authMode === 'signup';

  const strength = useMemo(() => (isSignup ? checkPassword(password) : null), [isSignup, password]);

  // Reset local state whenever the dialog opens or the mode flips, so a
  // stale password never lingers between "sign in" and "create account".
  useEffect(() => {
    if (authOpen) {
      setStep('form');
      setFieldErrors({});
      setFormError(null);
      setShowPassword(false);
      setTotpCode('');
      setPendingToken('');
      setConfirm('');
    }
  }, [authOpen, authMode]);

  const finishAuth = (user: Parameters<typeof adoptAuthenticatedUser>[1]) => {
    // Adopt BEFORE invalidating: cancels any in-flight (stale) /me fetch and
    // paints the signed-in UI instantly — a racing guest response can never
    // overwrite the fresh session.
    adoptAuthenticatedUser(queryClient, user);
    invalidateIdentityCaches(queryClient);
    setPassword('');
    setConfirm('');
    closeAuth();
    // Return the user to exactly what they were doing (e.g. the title they
    // tried to play while signed out).
    if (authReturnTo) {
      router.push(authReturnTo, { scroll: false });
    }
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (isSignup && name.trim().length > 40) next.name = 'Keep it under 40 characters.';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (isSignup) {
      if (password.length < 8) {
        next.password = 'Use at least 8 characters.';
      } else if (strength && !strength.acceptable) {
        next.password = strength.problems[0] ?? 'That password is too weak.';
      }
      if (confirm !== password) next.confirm = 'The passwords do not match.';
    } else if (password.length < 1) {
      next.password = 'Enter your password.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (isSignup) {
        const { user, verificationSent } = await registerAccount(name, email, password);
        toast.success(`Welcome to CineDeck, ${user.name || user.email.split('@')[0]}!`, {
          description: 'Your guest lists (if any) moved into your account.',
        });
        adoptAuthenticatedUser(queryClient, user);
        invalidateIdentityCaches(queryClient);
        setPassword('');
        setConfirm('');
        closeAuth();
        if (verificationSent) {
          setStep('verify-email');
        }
        return;
      }
      const result = await loginAccount(email, password);
      if (isTotpPending(result)) {
        setPendingToken(result.pendingToken);
        setStep('totp');
        setSubmitting(false);
        return;
      }
      toast.success(`Welcome back, ${result.name || result.email.split('@')[0]}!`, {
        description: 'My List & history are now synced to your account.',
      });
      finishAuth(result);
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'weak_password' && error.problems?.length) {
          setFieldErrors((prev) => ({ ...prev, password: error.problems?.[0] }));
        }
        if (error.code === 'bad_request') {
          setFieldErrors((prev) => ({
            ...prev,
            email: prev.email ?? (isSignup ? 'Check your details.' : undefined),
            password: prev.password ?? (isSignup ? 'Use at least 8 characters.' : undefined),
          }));
        }
        setFormError(error.message || AUTH_ERROR_TEXT[error.code]);
      } else {
        setFormError(AUTH_ERROR_TEXT.unknown);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Native form submit (Enter key) and the button click share this path. */
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const totpSubmit = async (): Promise<void> => {
    if (submitting || !pendingToken) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const user = await verifyTotpLogin(pendingToken, totpCode);
      toast.success(`Welcome back, ${user.name || user.email.split('@')[0]}!`, {
        description: 'Two-factor sign-in complete.',
      });
      finishAuth(user);
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'pending_expired') {
          setStep('form');
        }
        setFormError(error.message || AUTH_ERROR_TEXT[error.code]);
      } else {
        setFormError(AUTH_ERROR_TEXT.unknown);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onTotpSubmit = (event: FormEvent) => {
    event.preventDefault();
    void totpSubmit();
  };

  const forgotSubmit = async (): Promise<void> => {
    if (submitting) return;
    setFormError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: 'Enter a valid email address.' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      // Always succeeds from the user's perspective — no existence leaks.
      await requestPasswordReset(email.trim());
      setStep('forgot-done');
    } catch {
      setStep('forgot-done');
    } finally {
      setSubmitting(false);
    }
  };

  const onForgotSubmit = (event: FormEvent) => {
    event.preventDefault();
    void forgotSubmit();
  };

  const switchTab = (tab: Tab) => {
    if (tab === 'forgot') {
      setStep('forgot');
      return;
    }
    setStep('form');
    openAuth(tab);
  };

  const inputClass =
    'h-11 rounded-lg border-zinc-200 bg-white/80 pl-10 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100 dark:placeholder:text-zinc-600';

  const fadeUp = (delay: number) => ({
    initial: reduceMotion ? undefined : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, delay },
  });

  const titles: Record<Step, { title: string; description: string }> = {
    form: {
      title: isSignup ? 'Create your account' : 'Welcome back',
      description: isSignup
        ? 'Free forever. My List, continue watching & settings follow you to any device.'
        : 'Sign in to sync My List and continue watching across your devices.',
    },
    totp: {
      title: 'Two-factor sign-in',
      description: 'Enter the 6-digit code from your authenticator app — or a backup code.',
    },
    forgot: {
      title: 'Reset your password',
      description: 'We’ll email you a reset link that works for 30 minutes.',
    },
    'forgot-done': {
      title: 'Check your inbox',
      description: 'If that address has an account, a reset link is on its way.',
    },
    'verify-email': {
      title: 'Check your inbox',
      description: 'Confirm your email address — the app is already usable.',
    },
  };

  const activeTab: Tab = step === 'forgot' || step === 'forgot-done' ? 'forgot' : authMode;

  return (
    <Dialog open={authOpen} onOpenChange={(open) => !open && closeAuth()}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden rounded-2xl border-zinc-200 bg-zinc-50 p-0 dark:border-zinc-800/80 dark:bg-zinc-950"
      >
        {/* Brand band */}
        <div className="relative border-b border-zinc-200 bg-white/70 px-6 pb-5 pt-6 dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 right-0 h-40 w-56 rounded-full bg-brand-soft blur-3xl"
          />
          <DialogHeader className="space-y-2 text-left">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-[0_0_18px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)]">
              {step === 'totp' ? (
                <Smartphone className="size-5.5" aria-hidden />
              ) : (
                <Clapperboard className="size-5.5" aria-hidden />
              )}
            </span>
            <DialogTitle className="pt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {titles[step].title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {titles[step].description}
            </DialogDescription>
          </DialogHeader>

          {/* Contextual nudge (e.g. the title the guest tried to play) */}
          {authNotice && step !== 'forgot-done' && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
              {authNotice}
            </p>
          )}

          {/* Tab strip: Sign in / Sign up / Forgot password */}
          {step !== 'forgot-done' && step !== 'verify-email' && (
            <div role="tablist" aria-label="Authentication" className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
              {(['signin', 'signup', 'forgot'] as Tab[]).map((tab) => {
                const active = activeTab === tab && (tab !== 'signin' || !isSignup) && (tab !== 'signup' || isSignup);
                const label = tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Sign up' : 'Forgot';
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchTab(tab)}
                    className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {step === 'form' && (
          <form onSubmit={onSubmit} noValidate className="space-y-4 px-6 py-5">
            {isSignup && (
              <motion.div {...fadeUp(0)} className="space-y-1.5">
                <Label htmlFor="auth-name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Display name <span className="text-zinc-400">(optional)</span>
                </Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                  <Input
                    id="auth-name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Movie night host"
                    className={inputClass}
                    maxLength={40}
                  />
                </div>
                {fieldErrors.name && <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.name}</p>}
              </motion.div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </div>
              {fieldErrors.email && <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-password" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? '8+ chars, number & symbol' : 'Your password'}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
              {/* Live strength meter (signup only) */}
              {isSignup && strength && password.length > 0 && (
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
              {fieldErrors.password && <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.password}</p>}
            </div>

            {isSignup && (
              <motion.div {...fadeUp(0.05)} className="space-y-1.5">
                <Label htmlFor="auth-confirm" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Confirm password
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                  <Input
                    id="auth-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat the password"
                    className={inputClass}
                  />
                </div>
                {fieldErrors.confirm && <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.confirm}</p>}
              </motion.div>
            )}

            {formError && (
              <motion.div
                initial={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {formError}
              </motion.div>
            )}

            <Button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_20%,transparent)] hover:bg-brand/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {isSignup ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  <LogIn className="size-4" aria-hidden />
                  {isSignup ? 'Create account' : 'Sign in'}
                </>
              )}
            </Button>

            <p className="flex items-center justify-center gap-1 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <ShieldCheck className="size-3" aria-hidden />
              Guests keep everything on this device — sign up any time to sync.
            </p>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={onTotpSubmit} noValidate className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="auth-totp" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Authenticator or backup code
              </Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  id="auth-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^\dA-Za-z-]/g, '').slice(0, 9))}
                  placeholder="123456 or XXXX-XXXX"
                  className={`${inputClass} font-mono tracking-[0.2em]`}
                />
              </div>
            </div>
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {formError}
              </div>
            )}
            <Button
              type="button"
              onClick={() => void totpSubmit()}
              disabled={submitting || totpCode.length < 6}
              className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 hover:bg-brand/90"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Verify & sign in'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setFormError(null);
              }}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-brand dark:text-zinc-400"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Back to sign in
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={onForgotSubmit} noValidate className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Account email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  id="forgot-email"
                  type="email"
                  inputMode="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </div>
              {fieldErrors.email && <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
            </div>
            <Button
              type="button"
              onClick={() => void forgotSubmit()}
              disabled={submitting}
              className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 hover:bg-brand/90"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Send reset link'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setFormError(null);
              }}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-brand dark:text-zinc-400"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Back to sign in
            </button>
          </form>
        )}

        {step === 'forgot-done' && (
          <div className="space-y-4 px-6 py-6 text-center">
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              If <span className="font-semibold text-zinc-800 dark:text-zinc-200">{email}</span> has a CineDeck
              account, a password-reset link is on its way. It expires in 30 minutes.
            </p>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Running the dev server? The link is printed in the server console (console mail adapter).
            </p>
            <Button
              type="button"
              onClick={() => {
                setStep('form');
                setFormError(null);
              }}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-transparent text-sm font-medium text-zinc-700 hover:bg-zinc-200/70 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Back to sign in
            </Button>
          </div>
        )}

        {step === 'verify-email' && (
          <div className="space-y-4 px-6 py-6 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" aria-hidden />
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              We sent a verification link to <span className="font-semibold text-zinc-800 dark:text-zinc-200">{email}</span>.
              Click it whenever you like — your account works fully right now.
            </p>
            <Button
              type="button"
              onClick={() => {
                setStep('form');
              }}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-transparent text-sm font-medium text-zinc-700 hover:bg-zinc-200/70 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Continue to CineDeck
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
