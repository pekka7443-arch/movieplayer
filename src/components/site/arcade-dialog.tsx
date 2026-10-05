'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Dices, Flame, Gamepad2, Play, RefreshCw, Rocket, Sparkles, Trophy } from 'lucide-react';
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
  buildRounds,
  shuffleCopy,
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

function EmojiQuiz() {
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

  return (
    <Dialog open={arcadeOpen} onOpenChange={(open) => (!open ? closeArcade() : undefined)}>
      <DialogContent className="z-[70] max-w-lg gap-5 overflow-hidden border-zinc-200 bg-white p-6 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Gamepad2 className="size-5 text-amber-500 dark:text-amber-400" aria-hidden />
            CineDeck Arcade
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-500">
            Two tiny games for movie night — no TMDB key required.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quiz">
          <TabsList className="grid w-full grid-cols-2 bg-zinc-100 dark:bg-zinc-950/60">
            <TabsTrigger
              value="quiz"
              className="gap-1.5 data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Emoji Quiz
            </TabsTrigger>
            <TabsTrigger
              value="roulette"
              className="gap-1.5 data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
            >
              <Dices className="size-3.5" aria-hidden />
              Roulette
            </TabsTrigger>
          </TabsList>
          <TabsContent value="quiz" className="mt-4">
            <EmojiQuiz />
          </TabsContent>
          <TabsContent value="roulette" className="mt-4">
            <Roulette />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
