// Simulated platform growth overlay for the admin Overview.
//
// Purpose: the admin dashboard should read like a living product from day
// one — total users, signup charts and the activity feed all show organic,
// ever-increasing numbers instead of a lonely real user or two.
//
// Design contract (do not break):
// - PURE + DETERMINISTIC. No DB access, no writes, no cron. Everything is
//   derived from `now` with a seeded PRNG, so numbers are stable within a
//   day (no flicker on refresh) yet grow day over day — and even intraday,
//   because today's signups accumulate along a diurnal (evening-heavy)
//   curve. The next day the total is strictly higher.
// - Numbers never decrease: daily signups have noise, but the cumulative
//   base only moves forward.
// - Real security surfaces (sessions, failed logins, audit, suspended
//   counts) are never faked — only growth optics.
// - Seeded per (metric, day, slot): changing one number never reshuffles
//   the whole curve.

// "Platform launch" — the day the simulated member base started at zero.
const LAUNCH_UTC_MS = Date.UTC(2025, 2, 14); // 2025-03-14

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Seeded PRNG (xmur3 hash -> mulberry32)
// ---------------------------------------------------------------------------

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic [0,1) for a stable key like "signup:412" or "user:412:7". */
function rand(key: string): number {
  return mulberry32(hashSeed(key))();
}

// ---------------------------------------------------------------------------
// Core curve: signups per simulated day
// ---------------------------------------------------------------------------

/** Slow linear ramp — a niche product finding its audience. */
function trendOnDay(dayIndex: number): number {
  return 3.2 + 0.0135 * dayIndex;
}

// Sun..Sat multipliers: weekend signup bump, Monday dip.
const WEEKDAY_FACTOR = [1.04, 0.91, 0.94, 0.99, 1.03, 1.1, 1.21] as const;

function weekdayIndexForDay(dayIndex: number): number {
  // Launch day 2025-03-14 is a Friday (weekday 5).
  return (5 + dayIndex) % 7;
}

/** Simulated new registrations for the given day index (>= 1 always). Memoized per process. */
const signupsCache = new Map<number, number>();
export function signupsOnDay(dayIndex: number): number {
  const clamped = Math.max(0, Math.floor(dayIndex));
  const cached = signupsCache.get(clamped);
  if (cached !== undefined) return cached;
  const noise = 0.78 + 0.44 * rand(`signup:${clamped}`);
  // Occasional "press mention" spike — one every ~6 weeks.
  const spike = clamped % 43 === 17 ? 1.55 + 0.55 * rand(`spike:${clamped}`) : 1;
  const value = Math.max(1, Math.round(trendOnDay(clamped) * WEEKDAY_FACTOR[weekdayIndexForDay(clamped)] * noise * spike));
  signupsCache.set(clamped, value);
  return value;
}

/** Cumulative member count at the END of the given day index (inclusive). Memoized per process. */
const totalsCache = new Map<number, number>();
export function totalAtEndOfDay(dayIndex: number): number {
  const clamped = Math.max(0, Math.floor(dayIndex));
  const cached = totalsCache.get(clamped);
  if (cached !== undefined) return cached;
  let sum = 0;
  for (let d = 0; d <= clamped; d++) sum += signupsOnDay(d);
  totalsCache.set(clamped, sum);
  return sum;
}

/** Day index (0-based from launch) for a calendar date, UTC-aligned. */
export function dayIndexFor(date: Date): number {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(0, Math.floor((utcMidnight - LAUNCH_UTC_MS) / DAY_MS));
}

export function dayKeyFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Diurnal curve — how much of "today's" signups have materialised so far.
// Evening-heavy (Finnish leisure browsing), quiet early morning.
// ---------------------------------------------------------------------------

const HOURLY_WEIGHTS = [
  0.6, 0.4, 0.3, 0.25, 0.25, 0.35, 0.5, 0.8, 1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.5, 2.0, 1.2,
] as const;

const HOUR_WEIGHT_TOTAL = HOURLY_WEIGHTS.reduce((a, b) => a + b, 0);

/** Fraction (0..1] of today's simulated signups realized at `now`. */
export function diurnalProgress(now: Date): number {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  let acc = 0;
  for (let i = 0; i < Math.min(23, Math.floor(h)); i++) acc += HOURLY_WEIGHTS[i];
  acc += (h - Math.floor(h)) * HOURLY_WEIGHTS[Math.min(23, Math.floor(h))];
  return Math.min(1, acc / HOUR_WEIGHT_TOTAL);
}

/** Relative "right now" activity (0..1) — peak late evening, trough ~04:00. */
function diurnalNow(now: Date): number {
  const h = now.getUTCHours();
  return HOURLY_WEIGHTS[h] / Math.max(...HOURLY_WEIGHTS);
}

// ---------------------------------------------------------------------------
// Actives derived from the base (kept well below total, ordered DAU<WAU<MAU)
// ---------------------------------------------------------------------------

function dauOnDay(dayIndex: number): number {
  const base = totalAtEndOfDay(dayIndex);
  const dow = weekdayIndexForDay(dayIndex);
  const weekend = dow === 0 || dow === 6 ? 1.1 : dow === 1 ? 0.95 : 1;
  return Math.round(base * (0.3 + 0.05 * rand(`dau:${dayIndex}`)) * weekend);
}

function wauOnDay(dayIndex: number): number {
  const base = totalAtEndOfDay(dayIndex);
  return Math.round(base * (0.52 + 0.04 * rand(`wau:${dayIndex}`)));
}

function mauOnDay(dayIndex: number): number {
  const base = totalAtEndOfDay(dayIndex);
  return Math.round(base * (0.74 + 0.03 * rand(`mau:${dayIndex}`)));
}

// ---------------------------------------------------------------------------
// Simulated member identities for the recent-activity feed
// ---------------------------------------------------------------------------

const FIRST_FI = ['Onni', 'Aino', 'Eero', 'Viivi', 'Sofia', 'Elias', 'Milla', 'Taavi', 'Helmi', 'Joona', 'Iida', 'Antti', 'Sanna', 'Mikko', 'Anni', 'Juho', 'Emilia', 'Otto', 'Veera', 'Leo', 'Siiri', 'Aleksi', 'Pinja', 'Väinö'] as const;
const FIRST_INTL = ['Liam', 'Emma', 'Noah', 'Olivia', 'Lucas', 'Mia', 'Jonas', 'Anna', 'Erik', 'Julia', 'Mateo', 'Ivan', 'Maria', 'Daniel', 'Laura', 'Nora'] as const;
const LAST_FI = ['Mäkinen', 'Korhonen', 'Salmela', 'Lahtinen', 'Virtanen', 'Nieminen', 'Laine', 'Heikkinen', 'Salonen', 'Heinonen', 'Kettunen', 'Rantanen', 'Lehtonen', 'Karjalainen', 'Hämäläinen', 'Koskinen', 'Jokinen', 'Peltola', 'Räsänen', 'Toivonen', 'Vainio', 'Silander'] as const;
const LAST_INTL = ['Bergström', 'Johansson', 'Nielsen', 'Schmidt', 'Müller', 'Novak', 'Kowalski', 'Dubois', 'Rossi', 'Petrov', 'Smith', 'Brown'] as const;

// Weighted country list (name, weight) — Finland first by a wide margin.
const COUNTRY_WEIGHTS: readonly [string, number][] = [
  ['Finland', 44], ['Sweden', 11], ['Germany', 8], ['United States', 7], ['Estonia', 5],
  ['United Kingdom', 4], ['Norway', 4], ['Denmark', 3], ['Netherlands', 3], ['France', 2],
  ['Russia', 2], ['Switzerland', 2], ['Poland', 2], ['Spain', 2], ['Belgium', 1],
];
const COUNTRY_WEIGHT_TOTAL = COUNTRY_WEIGHTS.reduce((a, [, w]) => a + w, 0);

const DOMAINS = ['gmail.com', 'outlook.com', 'icloud.com', 'hotmail.com', 'proton.me', 'suomi24.fi', 'live.com', 'yahoo.com'] as const;

function pickWeighted<T extends readonly (readonly [string, number])[]>(list: T, r: number): string {
  let acc = r * COUNTRY_WEIGHT_TOTAL;
  for (const [name, w] of list) {
    acc -= w;
    if (acc <= 0) return name;
  }
  return list[0][0];
}

function asciiFold(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/å/g, 'a')
    .replace(/é|è/g, 'e')
    .replace(/ü/g, 'u');
}

export interface SimUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  country: string;
  avatar: null;
}

/** One plausible member identity signed up at a weighted hour of `dayStart`. */
function simUser(dayIndex: number, slot: number, dayStartMs: number, nowMs: number): SimUser {
  const r1 = rand(`user:${dayIndex}:${slot}:name`);
  const r2 = rand(`user:${dayIndex}:${slot}:last`);
  const r3 = rand(`user:${dayIndex}:${slot}:country`);
  const r4 = rand(`user:${dayIndex}:${slot}:mail`);
  const r5 = rand(`user:${dayIndex}:${slot}:hour`);
  const r6 = rand(`user:${dayIndex}:${slot}:min`);

  const finnish = r1 < 0.62;
  const first = finnish ? FIRST_FI[Math.floor(r1 * 41) % FIRST_FI.length] : FIRST_INTL[Math.floor(r1 * 29) % FIRST_INTL.length];
  const last = finnish ? LAST_FI[Math.floor(r2 * 47) % LAST_FI.length] : LAST_INTL[Math.floor(r2 * 29) % LAST_INTL.length];
  const country = pickWeighted(COUNTRY_WEIGHTS, r3);
  const domain = DOMAINS[Math.floor(r4 * DOMAINS.length) % DOMAINS.length];

  // Weighted hour pick (diurnal), then clamp to "now" for today.
  let hourAcc = r5 * HOUR_WEIGHT_TOTAL;
  let hour = 0;
  for (let h = 0; h < 24; h++) {
    hourAcc -= HOURLY_WEIGHTS[h];
    if (hourAcc <= 0) {
      hour = h;
      break;
    }
    hour = h;
  }
  let minute = Math.floor(r6 * 60);
  let ts = dayStartMs + hour * 3_600_000 + minute * 60_000;
  if (ts > nowMs) {
    hour = Math.max(0, new Date(nowMs).getUTCHours() - 1);
    minute = Math.floor(r6 * 59);
    ts = dayStartMs + hour * 3_600_000 + minute * 60_000;
    if (ts > nowMs) ts = nowMs - 60_000;
  }

  const email = `${asciiFold(first)}.${asciiFold(last)}${100 + Math.floor(r4 * 880)}@${domain}`;
  return {
    id: `sim-${dayIndex}-${slot}`,
    name: `${first} ${last}`,
    email,
    role: 'user',
    createdAt: new Date(ts).toISOString(),
    country,
    avatar: null,
  };
}

// ---------------------------------------------------------------------------
// Snapshot — everything the admin overview needs, merged by the caller
// ---------------------------------------------------------------------------

export interface GrowthSeriesPoint {
  day: string;
  count: number;
}

export interface GrowthSnapshot {
  totalUsers: number;
  newToday: number;
  newWeek: number;
  newPrevWeek: number;
  active24h: number;
  active7d: number;
  active30d: number;
  activeNow: number;
  verified: number;
  signupSeries: GrowthSeriesPoint[];
  dauSeries: GrowthSeriesPoint[];
  wauSeries: GrowthSeriesPoint[];
  mauSeries: GrowthSeriesPoint[];
  countries: { name: string; count: number }[];
  recentUsers: SimUser[];
}

const SERIES_DAYS = 30;

/** Full simulated-growth snapshot for "now". Deterministic per calendar day + intraday diurnal progress. */
export function growthSnapshot(now: Date = new Date()): GrowthSnapshot {
  const todayIdx = dayIndexFor(now);
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const progress = diurnalProgress(now);

  // Today's signups materialise along the diurnal curve.
  const newToday = Math.round(signupsOnDay(todayIdx) * progress);
  const totalUsers = totalAtEndOfDay(todayIdx - 1) + newToday;

  let week = 0;
  let prevWeek = 0;
  for (let d = todayIdx; d > todayIdx - 7; d--) {
    const share = d === todayIdx ? progress : 1;
    week += Math.round(signupsOnDay(d) * share);
  }
  for (let d = todayIdx - 7; d > todayIdx - 14; d--) prevWeek += signupsOnDay(d);

  const dayKeys: string[] = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i--) dayKeys.push(dayKeyFor(new Date(now.getTime() - i * DAY_MS)));

  const signupSeries: GrowthSeriesPoint[] = dayKeys.map((day, i) => {
    const idx = todayIdx - (SERIES_DAYS - 1 - i);
    const share = idx === todayIdx ? progress : 1;
    return { day, count: Math.round(signupsOnDay(idx) * share) };
  });
  const dauSeries = dayKeys.map((_, i) => {
    const idx = todayIdx - (SERIES_DAYS - 1 - i);
    return { day: dayKeys[i], count: idx === todayIdx ? Math.round(dauOnDay(idx) * Math.max(0.35, progress)) : dauOnDay(idx) };
  });
  const wauSeries = dayKeys.map((_, i) => {
    const idx = todayIdx - (SERIES_DAYS - 1 - i);
    return { day: dayKeys[i], count: wauOnDay(Math.max(0, idx)) };
  });
  const mauSeries = dayKeys.map((_, i) => {
    const idx = todayIdx - (SERIES_DAYS - 1 - i);
    return { day: dayKeys[i], count: mauOnDay(Math.max(0, idx)) };
  });

  const countries = COUNTRY_WEIGHTS.map(([name, w]) => ({
    name,
    count: Math.round((w / COUNTRY_WEIGHT_TOTAL) * totalUsers),
  }));

  // Feed: today's realized signups + all of yesterday (fresh, sorted desc).
  const todayCount = Math.max(1, newToday);
  const todayUsers: SimUser[] = Array.from({ length: todayCount }, (_, i) => simUser(todayIdx, i, todayStartMs, now.getTime()));
  const yStartMs = todayStartMs - DAY_MS;
  const yIdx = todayIdx - 1;
  const yCount = yIdx >= 0 ? signupsOnDay(yIdx) : 0;
  const yesterdayUsers: SimUser[] = Array.from({ length: yCount }, (_, i) => simUser(yIdx, i, yStartMs, now.getTime()));

  return {
    totalUsers,
    newToday,
    newWeek: week,
    newPrevWeek: prevWeek,
    active24h: dauOnDay(todayIdx),
    active7d: wauOnDay(todayIdx),
    active30d: mauOnDay(todayIdx),
    activeNow: Math.max(3, Math.round(dauOnDay(todayIdx) * 0.018 * Math.max(0.12, diurnalNow(now)))),
    verified: Math.round(totalUsers * 0.87),
    signupSeries,
    dauSeries,
    wauSeries,
    mauSeries,
    countries,
    recentUsers: [...todayUsers, ...yesterdayUsers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
