'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Dices, Flame, Gamepad2, Play, RefreshCw, Rocket, Sparkles, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCinedeckStore } from '@/lib/store';
import {
  MOODS,
  ROULETTE_PICKS,
  buildDailyRounds,
  buildRounds,
  buildYearRounds,
  shuffleCopy,
  todayIso,
  type Mood,
  type QuizRound,
  type RoulettePick,
} from '@/lib/arcade-data';

const BEST_STREAK_KEY = 'cinedeck.arcade.bestStreak';
const BEST_SCORE_KEY = 'cinedeck.arcade.bestScore';

function loadNumber(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(window.localStorage.getItem(key) ?? '0') || 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // storage full / private mode — ignore
  }
}

function quizRating(score: number, total: number): { emoji: string; title: string } {
  const ratio = total > 0 ? score / total : 0;
  if (ratio === 1) return { emoji: '🏆', title: 'Perfect run — CineDeck Legend!' };
  if (ratio >= 0.8) return { emoji: '🍿', title: 'Popcorn Prodigy' };
  if (ratio >= 0.6) return { emoji: '🎬', title: 'Solid Cinephile' };
  if (ratio >= 0.3) return { emoji: '🛋️', title: 'Casual Watcher' };
  return { emoji: '😴', title: 'Trailer Skipper' };
}

// ---------------------------------------------------------------------------
// Confetti burst — tiny framer-motion particle shower, no extra deps
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = ['#fbbf24', '#f59e0b', '#34d399', '#f87171', '#e879f9', '#a78bfa', '#f472b6'];

function ConfettiBurst({ burstId }: { burstId: number }) {
  const reduceMotion = useReducedMotion();

  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
        const distance = 90 + Math.random() * 150;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance - 60,
          rot: Math.random() * 720 - 360,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: Math.random() * 0.06,
          width: 5 + Math.random() * 6,
          height: 8 + Math.random() * 8,
          round: Math.random() > 0.5,
        };
      }),
    [burstId],
  );

  if (reduceMotion) return null;

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {particles.map((p) => (
        <motion.span
          key={`${burstId}-${p.id}`}
          initial={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
          animate={{ opacity: 0, x: p.x, y: [0, p.y, p.y + 200], rotate: p.rot, scale: 0.7 }}
          transition={{ duration: 1.2 + Math.random() * 0.35, ease: 'easeOut', delay: p.delay }}
          className="absolute left-1/2 top-1/2"
          style={{
            width: p.width,
            height: p.round ? p.width : p.height,
            borderRadius: p.round ? 999 : 1,
            backgroundColor: p.color,
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Emoji quiz
// ---------------------------------------------------------------------------

const ROUNDS = 10;

function EmojiQuiz({ onFinish }: { onFinish?: (score: number, total: number) => void }) {
  const reduceMotion = useReducedMotion();
  const [rounds, setRounds] = useState<QuizRound[]>(() => buildRounds(ROUNDS));
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(() => loadNumber(BEST_STREAK_KEY));
  const [bestScore, setBestScore] = useState(() => loadNumber(BEST_SCORE_KEY));
  const [burst, setBurst] = useState(0);
  const advanceTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const done = index >= rounds.length;
  const round = done ? null : rounds[index];
  const correct = round ? chosen === round.item.answer : false;
  const score = results.filter(Boolean).length;

  const choose = (option: string) => {
    if (chosen || !round) return;
    setChosen(option);
    const isCorrect = option === round.item.answer;
    setResults((prev) => [...prev, isCorrect]);

    if (isCorrect) {
      setBurst((b) => b + 1);
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      if (nextStreak > bestStreak) {
        setBestStreak(nextStreak);
        saveNumber(BEST_STREAK_KEY, nextStreak);
      }
    } else {
      setStreak(0);
    }

    // Last round just answered — persist the all-time best game score.
    if (index === rounds.length - 1) {
      const finalScore = results.filter(Boolean).length + (isCorrect ? 1 : 0);
      if (finalScore > loadNumber(BEST_SCORE_KEY)) saveNumber(BEST_SCORE_KEY, finalScore);
      setBestScore((prev) => Math.max(prev, finalScore));
      onFinish?.(finalScore, rounds.length);
    }

    advanceTimer.current = window.setTimeout(() => {
      setChosen(null);
      setIndex((i) => i + 1);
    }, reduceMotion ? 700 : 1350);
  };

  const restart = () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    setRounds(buildRounds(ROUNDS));
    setIndex(0);
    setChosen(null);
    setResults([]);
    setStreak(0);
    setBurst(0);
  };

  if (done) {
    const rating = quizRating(score, rounds.length);
    const celebrate = score >= ROUNDS * 0.8;
    return (
      <div className="relative flex flex-col items-center gap-4 py-6 text-center" role="status">
        {celebrate && burst > 0 && <ConfettiBurst key={`end-${burst}`} burstId={burst + 999} />}
        <motion.span
          initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="text-6xl"
          aria-hidden
        >
          {rating.emoji}
        </motion.span>
        <div>
          <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {score} / {rounds.length}
          </p>
          <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">{rating.title}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Trophy className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden />
            Best game: {bestScore}
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden />
            Best streak: {bestStreak}
          </span>
        </div>
        <Button
          type="button"
          onClick={restart}
          className="mt-1 h-10 gap-2 rounded-lg bg-amber-400 px-5 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          <RefreshCw className="size-4" aria-hidden />
          Play again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* status row */}
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium">
          Round {index + 1} / {rounds.length}
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1" aria-label={`Score: ${score}`}>
            <Trophy className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden />
            {score}
          </span>
          <span className="inline-flex items-center gap-1" aria-label={`Streak: ${streak}`}>
            <Flame
              className={
                'size-3.5 ' + (streak > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-400')
              }
              aria-hidden
            />
            {streak > 0 ? `🔥 ×${streak}` : '—'}
          </span>
          <span aria-label={`Best streak: ${bestStreak}`}>best {bestStreak}</span>
        </span>
      </div>

      {/* progress dots */}
      <div className="flex gap-1.5" aria-hidden>
        {rounds.map((_, i) => (
          <span
            key={i}
            className={
              'h-1.5 flex-1 rounded-full transition-colors ' +
              (i < results.length
                ? results[i]
                  ? 'bg-emerald-500'
                  : 'bg-red-500'
                : i === index
                  ? 'bg-amber-400'
                  : 'bg-zinc-200 dark:bg-zinc-800')
            }
          />
        ))}
      </div>

      {/* emoji clue */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200/40 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        {burst > 0 && <ConfettiBurst key={burst} burstId={burst} />}
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="select-none px-4 text-5xl leading-tight tracking-widest sm:text-6xl"
            aria-label="Movie emoji clue"
          >
            {round?.item.emojis}
          </motion.p>
        </AnimatePresence>
        <p className="mt-3 text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Which title is this?
        </p>
      </div>

      {/* options */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Answer options">
        {round !== null &&
          round.options.map((option) => {
            const isAnswer = option === round.item.answer;
            const isChosen = option === chosen;
            let style =
              'border-zinc-200 bg-white text-zinc-800 hover:border-amber-400/60 hover:bg-amber-400/5 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/10';
            if (chosen) {
              if (isAnswer) {
                style =
                  'border-emerald-500/70 bg-emerald-400/10 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-400';
              } else if (isChosen) {
                style =
                  'border-red-500/70 bg-red-400/10 text-red-700 dark:border-red-400/60 dark:bg-red-400/10 dark:text-red-400';
              } else {
                style =
                  'border-zinc-200 bg-white/50 text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-400';
              }
            }
            return (
              <Button
                key={option}
                type="button"
                variant="outline"
                disabled={Boolean(chosen)}
                onClick={() => choose(option)}
                className={
                  'h-auto justify-center whitespace-normal px-4 py-3 text-sm font-medium transition-colors ' + style
                }
              >
                {option}
              </Button>
            );
          })}
      </div>

      {/* feedback */}
      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm">
        {chosen &&
          round &&
          (correct ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Nailed it! It&apos;s {round.item.answer} ({round.item.year})
            </span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400">
              Nope — it was{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">{round.item.answer}</span> (
              {round.item.year})
            </span>
          ))}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year quiz — "what year did it come out?"
// ---------------------------------------------------------------------------

function YearQuiz() {
  const reduceMotion = useReducedMotion();
  const [rounds, setRounds] = useState(() => buildYearRounds(ROUNDS));
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [bestScore, setBestScore] = useState(() => loadNumber(BEST_SCORE_KEY));
  const [burst, setBurst] = useState(0);
  const advanceTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const done = index >= rounds.length;
  const round = done ? null : rounds[index];
  const correct = round ? chosen === round.year : false;
  const score = results.filter(Boolean).length;

  const choose = (option: number) => {
    if (chosen !== null || !round) return;
    setChosen(option);
    const isCorrect = option === round.year;
    setResults((prev) => [...prev, isCorrect]);
    if (isCorrect) setBurst((b) => b + 1);

    if (index === rounds.length - 1) {
      const finalScore = results.filter(Boolean).length + (isCorrect ? 1 : 0);
      if (finalScore > loadNumber(BEST_SCORE_KEY)) saveNumber(BEST_SCORE_KEY, finalScore);
      setBestScore((prev) => Math.max(prev, finalScore));
      void submitArcadeScore('year-quiz', finalScore, rounds.length);
    }

    advanceTimer.current = window.setTimeout(() => {
      setChosen(null);
      setIndex((i) => i + 1);
    }, reduceMotion ? 700 : 1350);
  };

  const restart = () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    setRounds(buildYearRounds(ROUNDS));
    setIndex(0);
    setChosen(null);
    setResults([]);
    setBurst(0);
  };

  if (done) {
    const rating = quizRating(score, rounds.length);
    return (
      <div className="relative flex flex-col items-center gap-4 py-6 text-center" role="status">
        {score >= ROUNDS * 0.8 && burst > 0 && <ConfettiBurst key={`year-end-${burst}`} burstId={burst + 999} />}
        <motion.span
          initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="text-6xl"
          aria-hidden
        >
          {rating.emoji}
        </motion.span>
        <div>
          <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {score} / {rounds.length}
          </p>
          <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">{rating.title}</p>
        </div>
        <p className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <Trophy className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden />
          Best game: {bestScore}
        </p>
        <Button
          type="button"
          onClick={restart}
          className="mt-1 h-10 gap-2 rounded-lg bg-amber-400 px-5 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          <RefreshCw className="size-4" aria-hidden />
          Play again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium">
          Round {index + 1} / {rounds.length}
        </span>
        <span className="inline-flex items-center gap-1" aria-label={`Score: ${score}`}>
          <Trophy className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden />
          {score}
        </span>
      </div>

      <div className="flex gap-1.5" aria-hidden>
        {rounds.map((_, i) => (
          <span
            key={i}
            className={
              'h-1.5 flex-1 rounded-full transition-colors ' +
              (i < results.length
                ? results[i]
                  ? 'bg-emerald-500'
                  : 'bg-red-500'
                : i === index
                  ? 'bg-amber-400'
                  : 'bg-zinc-200 dark:bg-zinc-800')
            }
          />
        ))}
      </div>

      {/* title clue */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200/40 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        {burst > 0 && <ConfettiBurst key={`year-${burst}`} burstId={burst} />}
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="px-4 text-2xl font-bold tracking-tight sm:text-3xl"
            aria-label="Movie title clue"
          >
            {round?.title}
          </motion.p>
        </AnimatePresence>
        <p className="mt-3 text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          What year did it release?
        </p>
      </div>

      {/* year options */}
      <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Year options">
        {round !== null &&
          round.options.map((option) => {
            const isAnswer = option === round.year;
            const isChosen = option === chosen;
            let style =
              'border-zinc-200 bg-white text-zinc-800 hover:border-amber-400/60 hover:bg-amber-400/5 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/10';
            if (chosen !== null) {
              if (isAnswer) {
                style =
                  'border-emerald-500/70 bg-emerald-400/10 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-400';
              } else if (isChosen) {
                style =
                  'border-red-500/70 bg-red-400/10 text-red-700 dark:border-red-400/60 dark:bg-red-400/10 dark:text-red-400';
              } else {
                style =
                  'border-zinc-200 bg-white/50 text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-400';
              }
            }
            return (
              <Button
                key={option}
                type="button"
                variant="outline"
                disabled={chosen !== null}
                onClick={() => choose(option)}
                className={'justify-center px-4 py-3 font-mono text-base font-semibold transition-colors ' + style}
              >
                {option}
              </Button>
            );
          })}
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm">
        {chosen !== null &&
          round &&
          (correct ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Nailed it! {round.title} is from {round.year}
            </span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400">
              Nope —{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">{round.title}</span> came out in{' '}
              {round.year}
            </span>
          ))}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily challenge — deterministic rounds per UTC date, one attempt result
// ---------------------------------------------------------------------------

function dailyDoneKey(): string {
  return `cinedeck.arcade.daily.${todayIso()}`;
}

async function submitArcadeScore(game: string, score: number, total: number): Promise<boolean> {
  try {
    const res = await fetch('/api/arcade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, score, total }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { improved?: boolean; best?: number };
    if (data.improved) toast.success(`New personal best: ${score}/${total}`);
    return true;
  } catch {
    return false;
  }
}

function DailyChallenge() {
  const reduceMotion = useReducedMotion();
  const [rounds, setRounds] = useState<QuizRound[]>(() => buildDailyRounds(todayIso()));
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [burst, setBurst] = useState(0);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const advanceTimer = useRef<number | null>(null);

  // Load today's completion flag after mount (hydration-safe).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        setAlreadyDone(window.localStorage.getItem(dailyDoneKey()) != null);
      } catch {
        setAlreadyDone(false);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const done = index >= rounds.length;
  const round = done ? null : rounds[index];
  const correct = round ? chosen === round.item.answer : false;
  const score = results.filter(Boolean).length;

  const choose = (option: string) => {
    if (chosen || !round) return;
    setChosen(option);
    const isCorrect = option === round.item.answer;
    setResults((prev) => [...prev, isCorrect]);
    if (isCorrect) setBurst((b) => b + 1);

    if (index === rounds.length - 1) {
      const finalScore = results.filter(Boolean).length + (isCorrect ? 1 : 0);
      try {
        window.localStorage.setItem(dailyDoneKey(), String(finalScore));
      } catch {
        // private mode — daily completion stays session-only
      }
      setAlreadyDone(true);
      void submitArcadeScore('daily', finalScore, rounds.length);
    }

    advanceTimer.current = window.setTimeout(() => {
      setChosen(null);
      setIndex((i) => i + 1);
    }, reduceMotion ? 700 : 1350);
  };

  const started = index > 0 || chosen !== null || results.length > 0;

  if (done) {
    const rating = quizRating(score, rounds.length);
    return (
      <div className="relative flex flex-col items-center gap-4 py-6 text-center" role="status">
        {score >= rounds.length * 0.8 && burst > 0 && <ConfettiBurst key={`daily-end-${burst}`} burstId={burst + 999} />}
        <motion.span
          initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="text-6xl"
          aria-hidden
        >
          {rating.emoji}
        </motion.span>
        <div>
          <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {score} / {rounds.length}
          </p>
          <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
            {rating.title} · Daily challenge complete
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            A new challenge unlocks at midnight UTC — your score is on the leaderboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium">
          {todayIso()} · Round {Math.min(index + 1, rounds.length)} / {rounds.length}
        </span>
        {alreadyDone && started && <span className="font-medium text-amber-600 dark:text-amber-400">Good luck!</span>}
        {alreadyDone && !started && <span className="text-amber-600 dark:text-amber-400">Replay for fun — today&apos;s score is already saved</span>}
      </div>

      <div className="flex gap-1.5" aria-hidden>
        {rounds.map((_, i) => (
          <span
            key={i}
            className={
              'h-1.5 flex-1 rounded-full transition-colors ' +
              (i < results.length
                ? results[i]
                  ? 'bg-emerald-500'
                  : 'bg-red-500'
                : i === index
                  ? 'bg-amber-400'
                  : 'bg-zinc-200 dark:bg-zinc-800')
            }
          />
        ))}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200/40 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        {burst > 0 && <ConfettiBurst key={`daily-${burst}`} burstId={burst} />}
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="select-none px-4 text-5xl leading-tight tracking-widest sm:text-6xl"
            aria-label="Movie emoji clue"
          >
            {round?.item.emojis}
          </motion.p>
        </AnimatePresence>
        <p className="mt-3 text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Which title is this?
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Answer options">
        {round !== null &&
          round.options.map((option) => {
            const isAnswer = option === round.item.answer;
            const isChosen = option === chosen;
            let style =
              'border-zinc-200 bg-white text-zinc-800 hover:border-amber-400/60 hover:bg-amber-400/5 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/10';
            if (chosen) {
              if (isAnswer) {
                style =
                  'border-emerald-500/70 bg-emerald-400/10 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-400';
              } else if (isChosen) {
                style =
                  'border-red-500/70 bg-red-400/10 text-red-700 dark:border-red-400/60 dark:bg-red-400/10 dark:text-red-400';
              } else {
                style =
                  'border-zinc-200 bg-white/50 text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:text-zinc-400';
              }
            }
            return (
              <Button
                key={option}
                type="button"
                variant="outline"
                disabled={Boolean(chosen)}
                onClick={() => choose(option)}
                className={
                  'h-auto justify-center whitespace-normal px-4 py-3 text-sm font-medium transition-colors ' + style
                }
              >
                {option}
              </Button>
            );
          })}
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-center text-sm">
        {chosen &&
          round &&
          (correct ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Nailed it! It&apos;s {round.item.answer} ({round.item.year})
            </span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400">
              Nope — it was{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">{round.item.answer}</span> (
              {round.item.year})
            </span>
          ))}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard — personal bests from /api/arcade (guests included)
// ---------------------------------------------------------------------------

interface ArcadeBoardRow {
  name: string;
  score: number;
  total: number | null;
  updatedAt: string;
}

const BOARD_GAMES = [
  { id: 'emoji-quiz', label: 'Emoji Quiz' },
  { id: 'daily', label: 'Daily Challenge' },
  { id: 'year-quiz', label: 'Year Quiz' },
] as const;

const BOARD_PERIODS = [
  { id: 'all', label: 'All time' },
  { id: 'month', label: 'This month' },
  { id: 'week', label: 'This week' },
  { id: 'today', label: 'Today' },
] as const;

function Leaderboard() {
  const [game, setGame] = useState<(typeof BOARD_GAMES)[number]['id']>('emoji-quiz');
  const [period, setPeriod] = useState<(typeof BOARD_PERIODS)[number]['id']>('all');
  const query = useQuery({
    queryKey: ['arcade-board', game, period],
    queryFn: async () => {
      const res = await fetch(`/api/arcade?game=${game}&period=${period}`);
      if (!res.ok) throw new Error('arcade_unreachable');
      return (await res.json()) as { rows: ArcadeBoardRow[]; mine: { score: number; rank: number | null } | null };
    },
    staleTime: 30_000,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a game">
        {BOARD_GAMES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGame(g.id)}
            aria-pressed={game === g.id}
            className={
              'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
              (game === g.id
                ? 'bg-brand text-white'
                : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200')
            }
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a time period">
        {BOARD_PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            aria-pressed={period === p.id}
            className={
              'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ' +
              (period === p.id
                ? 'border-brand/50 bg-brand/10 text-brand'
                : 'border-zinc-200 text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <div className="space-y-2 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="rounded-xl border border-zinc-200 bg-white/70 p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          The leaderboard is unreachable right now — try again in a moment.
        </p>
      ) : (query.data?.rows.length ?? 0) === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
          No scores yet — be the first to put your name on the board.
        </p>
      ) : (
        <>
          <ol className="space-y-1.5">
            {(query.data?.rows ?? []).map((row, i) => (
              <li
                key={`${row.name}-${row.updatedAt}`}
                className={
                  'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ' +
                  (i === 0
                    ? 'border-amber-400/50 bg-amber-400/5'
                    : 'border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/50')
                }
              >
                <span
                  className={
                    'w-6 shrink-0 text-center font-mono text-xs font-bold ' +
                    (i === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500')
                  }
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {row.name}
                </span>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                  {row.score}
                  {row.total ? <span className="text-zinc-400 dark:text-zinc-500">/{row.total}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          {query.data?.mine && (
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              Your best: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{query.data.mine.score}</span>
              {query.data.mine.rank != null && <> · rank #{query.data.mine.rank}</>}
            </p>
          )}
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
        <Trophy className="size-3" aria-hidden />
        Leaderboard keeps your best run per game — guests play under their device identity.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roulette — slot machine random pick
// ---------------------------------------------------------------------------

function Roulette() {
  const router = useRouter();
  const closeArcade = useCinedeckStore((s) => s.closeArcade);
  const reduceMotion = useReducedMotion();
  const [mood, setMood] = useState<Mood | 'all'>('all');
  const [reel, setReel] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<RoulettePick | null>(null);
  const [burst, setBurst] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const pool = useMemo(
    () => (mood === 'all' ? shuffleCopy(ROULETTE_PICKS) : shuffleCopy(ROULETTE_PICKS.filter((p) => p.mood === mood))),
    [mood],
  );

  const spin = () => {
    if (spinning || pool.length === 0) return;
    setSpinning(true);
    setResult(null);
    const winner = pool[Math.floor(Math.random() * pool.length)];

    if (reduceMotion) {
      timerRef.current = window.setTimeout(() => {
        setReel(winner.title);
        setResult(winner);
        setSpinning(false);
        setBurst((b) => b + 1);
      }, 350);
      return;
    }

    let elapsed = 0;
    let delay = 55;
    const tick = () => {
      const random = pool[Math.floor(Math.random() * pool.length)];
      setReel(random.title);
      elapsed += delay;
      delay = Math.round(delay * 1.14);
      if (elapsed < 2100) {
        timerRef.current = window.setTimeout(tick, delay);
      } else {
        setReel(winner.title);
        setResult(winner);
        setSpinning(false);
        setBurst((b) => b + 1);
      }
    };
    tick();
  };

  const openInCinedeck = (pick: RoulettePick) => {
    router.push(`/?id=${pick.tmdbId}&type=movie`, { scroll: false });
    closeArcade();
  };

  return (
    <div className="space-y-4">
      {/* mood filter */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a mood">
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              if (spinning) return;
              setMood(m.id);
              setResult(null);
              setReel(null);
            }}
            aria-pressed={mood === m.id}
            className={
              'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
              (mood === m.id
                ? 'bg-amber-400 text-zinc-950'
                : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200')
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* reel */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200/40 px-6 py-9 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
        {burst > 0 && <ConfettiBurst key={`reel-${burst}`} burstId={burst} />}
        <p
          className={
            'truncate text-lg font-semibold tracking-tight transition-colors sm:text-xl ' +
            (result
              ? 'text-amber-600 dark:text-amber-300'
              : spinning
                ? 'text-zinc-500 dark:text-zinc-400'
                : 'text-zinc-400 dark:text-zinc-400')
          }
          role="status"
          aria-live="polite"
        >
          {reel ?? 'Press SPIN and let fate decide'}
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          {spinning ? 'Rolling…' : 'Tonight\u2019s pick'}
        </p>
      </div>

      {/* actions */}
      <div className="flex items-center justify-center gap-2.5">
        <Button
          type="button"
          onClick={spin}
          disabled={spinning}
          className="h-10 gap-2 rounded-lg bg-amber-400 px-6 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
        >
          <Dices className={'size-4 ' + (spinning ? 'animate-bounce' : '')} aria-hidden />
          {spinning ? 'Rolling…' : 'Spin'}
        </Button>
      </div>

      {/* result card */}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`${result.tmdbId}`}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-center"
            role="status"
          >
            <p className="text-3xl" aria-hidden>
              {result.emoji}
            </p>
            <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {result.title} <span className="text-zinc-500 dark:text-zinc-400">· {result.year}</span>
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">&ldquo;{result.tagline}&rdquo;</p>
            <Button
              type="button"
              onClick={() => openInCinedeck(result)}
              className="mt-3 h-9 gap-2 rounded-lg bg-amber-400 px-4 text-xs font-semibold text-zinc-950 hover:bg-amber-300"
            >
              <Play className="size-3.5" aria-hidden />
              Watch in CineDeck
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
        <Rocket className="size-3" aria-hidden />
        Curated picks with real TMDB IDs — the player opens even without a TMDB key.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

export function ArcadeDialog() {
  const arcadeOpen = useCinedeckStore((s) => s.arcadeOpen);
  const closeArcade = useCinedeckStore((s) => s.closeArcade);
  const [quizMode, setQuizMode] = useState<'emoji' | 'year' | 'daily'>('emoji');

  return (
    <Dialog open={arcadeOpen} onOpenChange={(open) => (!open ? closeArcade() : undefined)}>
      <DialogContent className="z-[70] max-w-lg gap-5 overflow-hidden border-zinc-200 bg-white p-6 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Gamepad2 className="size-5 text-amber-500 dark:text-amber-400" aria-hidden />
            CineDeck Arcade
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-500">
            Tiny games for movie night — no TMDB key required.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quiz">
          <TabsList className="grid w-full grid-cols-3 bg-zinc-100 dark:bg-zinc-950/60">
            <TabsTrigger
              value="quiz"
              className="gap-1.5 data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Quiz
            </TabsTrigger>
            <TabsTrigger
              value="roulette"
              className="gap-1.5 data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
            >
              <Dices className="size-3.5" aria-hidden />
              Roulette
            </TabsTrigger>
            <TabsTrigger
              value="board"
              className="gap-1.5 data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
            >
              <Trophy className="size-3.5" aria-hidden />
              Board
            </TabsTrigger>
          </TabsList>
          <TabsContent value="quiz" className="mt-4">
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Pick a quiz">
              {(
                [
                  { id: 'emoji', label: 'Emoji' },
                  { id: 'year', label: 'Year' },
                  { id: 'daily', label: 'Daily challenge' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setQuizMode(m.id)}
                  aria-pressed={quizMode === m.id}
                  className={
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
                    (quizMode === m.id
                      ? 'bg-amber-400 text-zinc-950'
                      : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            {quizMode === 'emoji' && <EmojiQuiz onFinish={(s, t) => void submitArcadeScore('emoji-quiz', s, t)} />}
            {quizMode === 'year' && <YearQuiz />}
            {quizMode === 'daily' && <DailyChallenge />}
          </TabsContent>
          <TabsContent value="roulette" className="mt-4">
            <Roulette />
          </TabsContent>
          <TabsContent value="board" className="mt-4">
            <Leaderboard />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
