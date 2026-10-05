'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
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
}

type Step = 'form' | 'totp' | 'forgot' | 'forgot-done';

const STRENGTH_COLORS = ['bg-zinc-300 dark:bg-zinc-700', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400'];

/** Sign in / create account dialog — shared by the header CTA buttons. */
export function AuthDialog() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const authOpen = useCinedeckStore((s) => s.authOpen);
  const authMode = useCinedeckStore((s) => s.authMode);
  const closeAuth = useCinedeckStore((s) => s.closeAuth);
  const openAuth = useCinedeckStore((s) => s.openAuth);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    }
  }, [authOpen, authMode]);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (isSignup && name.trim().length > 40) next.name = 'Keep it under 40 characters.';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < (isSignup ? 8 : 1)) {
      next.password = isSignup ? 'Use at least 8 characters.' : 'Enter your password.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (isSignup) {
        const user = await registerAccount(name, email, password);
        toast.success(`Welcome to CineDeck, ${user.name || user.email.split('@')[0]}!`, {
          description: 'Your guest lists (if any) moved into your account.',
        });
      } else {
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
      }
      invalidateIdentityCaches(queryClient);
      setPassword('');
      closeAuth();
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
        setFormError(AUTH_ERROR_TEXT[error.code]);
      } else {
        setFormError(AUTH_ERROR_TEXT.unknown);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onTotpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !pendingToken) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const user = await verifyTotpLogin(pendingToken, totpCode);
      toast.success(`Welcome back, ${user.name || user.email.split('@')[0]}!`, {
        description: 'Two-factor sign-in complete.',
      });
      invalidateIdentityCaches(queryClient);
      setPassword('');
      setTotpCode('');
      closeAuth();
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'pending_expired') {
          setStep('form');
        }
        setFormError(AUTH_ERROR_TEXT[error.code]);
      } else {
        setFormError(AUTH_ERROR_TEXT.unknown);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onForgotSubmit = async (event: FormEvent) => {
    event.preventDefault();
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

  const switchMode = () => {
    openAuth(isSignup ? 'signin' : 'signup');
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
      description: 'Enter the 6-digit code from your authenticator app.',
    },
    forgot: {
      title: 'Reset your password',
      description: 'We’ll email you a reset link that works for 30 minutes.',
    },
    'forgot-done': {
      title: 'Check your inbox',
      description: 'If that address has an account, a reset link is on its way.',
    },
  };

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
                  placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
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
              type="submit"
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

            <div className="flex flex-col items-center gap-1.5 pb-1 text-center">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {isSignup ? 'Already have an account?' : 'New to CineDeck?'}{' '}
                <button
                  type="button"
                  onClick={switchMode}
                  className="font-semibold text-brand underline-offset-4 hover:underline"
                >
                  {isSignup ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              {!isSignup && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setStep('forgot');
                  }}
                  className="text-xs font-medium text-zinc-500 underline-offset-4 hover:text-brand hover:underline dark:text-zinc-400"
                >
                  Forgot your password?
                </button>
              )}
              <p className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                <ShieldCheck className="size-3" aria-hidden />
                Guests keep everything on this device — sign up any time to sync.
              </p>
            </div>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={onTotpSubmit} noValidate className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="auth-totp" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Authenticator code
              </Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input
                  id="auth-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  placeholder="123456"
                  className={`${inputClass} font-mono tracking-[0.3em]`}
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
              type="submit"
              disabled={submitting || totpCode.length !== 6}
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
              type="submit"
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
      </DialogContent>
    </Dialog>
  );
}
