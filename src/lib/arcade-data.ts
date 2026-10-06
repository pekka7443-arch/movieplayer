// ---------------------------------------------------------------------------
// CineDeck Arcade — curated local data. Works fully offline (no TMDB key).
// ---------------------------------------------------------------------------

export type Mood = 'funny' | 'scary' | 'mind' | 'feelgood' | 'action' | 'classic';

export const MOODS: { id: Mood | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'funny', label: '😂 Funny' },
  { id: 'scary', label: '😱 Scary' },
  { id: 'mind', label: '🤯 Mind-bender' },
  { id: 'feelgood', label: '🥹 Feel-good' },
  { id: 'action', label: '💥 Action' },
  { id: 'classic', label: '🎩 Classics' },
];

// ---------------------------------------------------------------------------
// Emoji quiz — guess the title from the emoji clue
// ---------------------------------------------------------------------------

export interface EmojiQuizItem {
  emojis: string;
  answer: string;
  year: number;
  mediaType: 'movie' | 'tv';
}

export const EMOJI_QUIZ: readonly EmojiQuizItem[] = [
  { emojis: '🦁👑', answer: 'The Lion King', year: 1994, mediaType: 'movie' },
  { emojis: '🕷️🧑', answer: 'Spider-Man', year: 2002, mediaType: 'movie' },
  { emojis: '🚢💔🧊', answer: 'Titanic', year: 1997, mediaType: 'movie' },
  { emojis: '🦈🌊', answer: 'Jaws', year: 1975, mediaType: 'movie' },
  { emojis: '🤖🌱🚀', answer: 'WALL·E', year: 2008, mediaType: 'movie' },
  { emojis: '🧙💍🌋', answer: 'The Lord of the Rings', year: 2001, mediaType: 'movie' },
  { emojis: '⚡🪄🎒', answer: 'Harry Potter', year: 2001, mediaType: 'movie' },
  { emojis: '🐭👨‍🍳', answer: 'Ratatouille', year: 2007, mediaType: 'movie' },
  { emojis: '🎈🤡', answer: 'It', year: 2017, mediaType: 'movie' },
  { emojis: '👽📞🚲', answer: 'E.T. the Extra-Terrestrial', year: 1982, mediaType: 'movie' },
  { emojis: '🦖🏝️', answer: 'Jurassic Park', year: 1993, mediaType: 'movie' },
  { emojis: '🦇🌃', answer: 'The Dark Knight', year: 2008, mediaType: 'movie' },
  { emojis: '❄️👭⛄', answer: 'Frozen', year: 2013, mediaType: 'movie' },
  { emojis: '🐠🔎', answer: 'Finding Nemo', year: 2003, mediaType: 'movie' },
  { emojis: '🧠🌀⏳', answer: 'Inception', year: 2010, mediaType: 'movie' },
  { emojis: '🚗⚡⏰', answer: 'Back to the Future', year: 1985, mediaType: 'movie' },
  { emojis: '🐼🥋', answer: 'Kung Fu Panda', year: 2008, mediaType: 'movie' },
  { emojis: '👻🚫', answer: 'Ghostbusters', year: 1984, mediaType: 'movie' },
  { emojis: '🥁😤🩸', answer: 'Whiplash', year: 2014, mediaType: 'movie' },
  { emojis: '🏭🎫🍫', answer: 'Charlie and the Chocolate Factory', year: 2005, mediaType: 'movie' },
  { emojis: '🧞🪔', answer: 'Aladdin', year: 1992, mediaType: 'movie' },
  { emojis: '🐯🌊', answer: 'Life of Pi', year: 2012, mediaType: 'movie' },
  { emojis: '🩰🦢🖤', answer: 'Black Swan', year: 2010, mediaType: 'movie' },
  { emojis: '🤡🃏', answer: 'Joker', year: 2019, mediaType: 'movie' },
  { emojis: '🧑‍🚀🥔🔴', answer: 'The Martian', year: 2015, mediaType: 'movie' },
  { emojis: '🧜‍♀️🎶', answer: 'The Little Mermaid', year: 1989, mediaType: 'movie' },
  { emojis: '👠📰', answer: 'The Devil Wears Prada', year: 2006, mediaType: 'movie' },
  { emojis: '💊🐇🕶️', answer: 'The Matrix', year: 1999, mediaType: 'movie' },
  { emojis: '🏎️💨', answer: 'Cars', year: 2006, mediaType: 'movie' },
  { emojis: '🐷🎤', answer: 'Sing', year: 2016, mediaType: 'movie' },
  { emojis: '🐕🍝', answer: 'Lady and the Tramp', year: 1955, mediaType: 'movie' },
  { emojis: '🐔🏃', answer: 'Chicken Run', year: 2000, mediaType: 'movie' },
  { emojis: '🧛🦇🩸', answer: 'Dracula', year: 1992, mediaType: 'movie' },
  { emojis: '👑🐺❄️', answer: 'Game of Thrones', year: 2011, mediaType: 'tv' },
  { emojis: '💸📈🍸', answer: 'The Wolf of Wall Street', year: 2013, mediaType: 'movie' },
  { emojis: '🏠👦🪤', answer: 'Home Alone', year: 1990, mediaType: 'movie' },
  { emojis: '🤠🧸🚀', answer: 'Toy Story', year: 1995, mediaType: 'movie' },
  { emojis: '🪓🚪✍️', answer: 'The Shining', year: 1980, mediaType: 'movie' },
  { emojis: '🎳🥃🧔', answer: 'The Big Lebowski', year: 1998, mediaType: 'movie' },
  { emojis: '🐹⏰🌀', answer: 'Groundhog Day', year: 1993, mediaType: 'movie' },
] as const;

export interface QuizRound {
  item: EmojiQuizItem;
  options: string[];
}

function shuffleCopy<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Build `count` quiz rounds; each has the clue title + 3 random distractors. */
export function buildRounds(count = 10): QuizRound[] {
  const picks = shuffleCopy(EMOJI_QUIZ).slice(0, Math.min(count, EMOJI_QUIZ.length));
  return picks.map((item) => {
    const distractors = shuffleCopy(
      EMOJI_QUIZ.filter((q) => q.answer !== item.answer),
    )
      .slice(0, 3)
      .map((q) => q.answer);
    return { item, options: shuffleCopy([item.answer, ...distractors]) };
  });
}

export { shuffleCopy };

// ---------------------------------------------------------------------------
// Year quiz — "what year did X come out?" from the same verified pool
// ---------------------------------------------------------------------------

export interface YearQuizRound {
  title: string;
  year: number;
  mediaType: 'movie' | 'tv';
  options: number[];
}

function distractorYears(correct: number, taken: Set<number>): number[] {
  const out: number[] = [];
  let offset = 1;
  while (out.length < 3 && offset < 40) {
    for (const sign of [-1, 1]) {
      const candidate = correct + sign * offset;
      if (candidate >= 1950 && candidate <= 2100 && !out.includes(candidate) && !taken.has(candidate)) {
        out.push(candidate);
        if (out.length === 3) break;
      }
    }
    offset += 1;
  }
  return out;
}

export function buildYearRounds(count = 10): YearQuizRound[] {
  const picks = shuffleCopy(EMOJI_QUIZ).slice(0, Math.min(count, EMOJI_QUIZ.length));
  return picks.map((item) => {
    const options = shuffleCopy([item.year, ...distractorYears(item.year, new Set([item.year]))]);
    return { title: item.answer, year: item.year, mediaType: item.mediaType, options };
  });
}

// ---------------------------------------------------------------------------
// Daily challenge — deterministic per-UTC-date selection (mulberry32 PRNG)
// ---------------------------------------------------------------------------

/** Stable string hash (FNV-1a) → 32-bit seed. */
export function dailySeed(dateIso: string, salt = 'cinedeck-daily'): number {
  let h = 0x811c9dc5;
  const input = `${salt}:${dateIso}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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

function seededShuffle<T>(input: readonly T[], rng: () => number): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deterministic emoji-quiz rounds for a given date — every device sees the same daily challenge. */
export function buildDailyRounds(dateIso: string, count = 8): QuizRound[] {
  const rng = mulberry32(dailySeed(dateIso));
  const picks = seededShuffle(EMOJI_QUIZ, rng).slice(0, Math.min(count, EMOJI_QUIZ.length));
  return picks.map((item) => {
    const distractors = seededShuffle(
      EMOJI_QUIZ.filter((q) => q.answer !== item.answer),
      rng,
    )
      .slice(0, 3)
      .map((q) => q.answer);
    return { item, options: seededShuffle([item.answer, ...distractors], rng) };
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Roulette — slot-machine random pick, all entries are real TMDB ids
// ---------------------------------------------------------------------------

export interface RoulettePick {
  title: string;
  year: number;
  tmdbId: number;
  emoji: string;
  tagline: string;
  mood: Mood;
}

export const ROULETTE_PICKS: readonly RoulettePick[] = [
  { title: 'The Shawshank Redemption', year: 1994, tmdbId: 278, emoji: '🔨📫', tagline: 'Hope is a good thing — and so is this movie.', mood: 'classic' },
  { title: 'The Godfather', year: 1972, tmdbId: 238, emoji: '🍝👑', tagline: "An offer you can't refuse.", mood: 'classic' },
  { title: 'Pulp Fiction', year: 1994, tmdbId: 680, emoji: '💼🍔', tagline: "Royale with cheese. Say 'what' again.", mood: 'classic' },
  { title: 'Fight Club', year: 1999, tmdbId: 550, emoji: '🧼👊', tagline: "Don't talk about it. Just watch it.", mood: 'mind' },
  { title: 'The Matrix', year: 1999, tmdbId: 603, emoji: '💊🕶️', tagline: 'There is no spoon. Take the pill.', mood: 'mind' },
  { title: 'Forrest Gump', year: 1994, tmdbId: 13, emoji: '🏃🍫', tagline: 'Life is like a box of chocolates.', mood: 'feelgood' },
  { title: 'Inception', year: 2010, tmdbId: 27205, emoji: '🌀🧠', tagline: 'Your floor is now my subconscious. Wake up.', mood: 'mind' },
  { title: 'Interstellar', year: 2014, tmdbId: 157336, emoji: '🚀🕳️', tagline: 'Do not go gentle into that good night.', mood: 'mind' },
  { title: 'The Dark Knight', year: 2008, tmdbId: 155, emoji: '🦇🃏', tagline: 'Why so serious tonight?', mood: 'action' },
  { title: 'Gladiator', year: 2000, tmdbId: 98, emoji: '⚔️🏛️', tagline: 'Are you not entertained?!', mood: 'action' },
  { title: 'The Lion King', year: 1994, tmdbId: 8587, emoji: '🦁👑', tagline: 'Hakuna Matata — it means no worries.', mood: 'feelgood' },
  { title: 'Toy Story', year: 1995, tmdbId: 862, emoji: '🤠🧸', tagline: 'To infinity and beyond the couch.', mood: 'feelgood' },
  { title: 'Back to the Future', year: 1985, tmdbId: 105, emoji: '🚗⚡', tagline: "Where we're going, we don't need roads.", mood: 'classic' },
  { title: 'Jurassic Park', year: 1993, tmdbId: 329, emoji: '🦖⚡', tagline: 'Life, uh, finds a way — onto your screen.', mood: 'action' },
  { title: 'Terminator 2: Judgment Day', year: 1991, tmdbId: 280, emoji: '🤖🏍️', tagline: 'Come with me if you want to live.', mood: 'action' },
  { title: 'Alien', year: 1979, tmdbId: 348, emoji: '👽🚀', tagline: 'In space no one can hear you scream.', mood: 'scary' },
  { title: 'The Shining', year: 1980, tmdbId: 694, emoji: '🪓🚪', tagline: 'All work and no play? Fix that.', mood: 'scary' },
  { title: 'Psycho', year: 1960, tmdbId: 539, emoji: '🚿🔪', tagline: "A boy's best friend is his mother.", mood: 'scary' },
  { title: 'Spirited Away', year: 2001, tmdbId: 129, emoji: '🐉🛁', tagline: "Once you're in, you won't want to leave.", mood: 'feelgood' },
  { title: 'Your Name', year: 2016, tmdbId: 372058, emoji: '☄️🎀', tagline: 'Two strangers, one very confusing calendar.', mood: 'feelgood' },
  { title: 'Parasite', year: 2019, tmdbId: 496243, emoji: '🏠🐜', tagline: 'The stairs tell the whole story.', mood: 'mind' },
  { title: 'Spider-Man: Into the Spider-Verse', year: 2018, tmdbId: 324857, emoji: '🕷️🌆', tagline: 'Anyone can wear the mask.', mood: 'action' },
  { title: 'The Grand Budapest Hotel', year: 2014, tmdbId: 120467, emoji: '🍰🛎️', tagline: 'Lobby boy wanted. Mustache preferred.', mood: 'funny' },
  { title: 'Whiplash', year: 2014, tmdbId: 244786, emoji: '🥁😤', tagline: 'Not quite my tempo. One more take.', mood: 'mind' },
  { title: 'La La Land', year: 2016, tmdbId: 313369, emoji: '💃🎹', tagline: "Here's to the fools who dream.", mood: 'feelgood' },
  { title: 'Mad Max: Fury Road', year: 2015, tmdbId: 76341, emoji: '🚗💥', tagline: 'What a lovely day!', mood: 'action' },
  { title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, emoji: '🤖🌧️', tagline: 'All the best memories are hers… or yours.', mood: 'mind' },
  { title: 'Dune', year: 2021, tmdbId: 438631, emoji: '🪱🏜️', tagline: 'The spice must flow.', mood: 'action' },
  { title: 'Oppenheimer', year: 2023, tmdbId: 872585, emoji: '☢️🎓', tagline: 'Now I am become Death… grab popcorn.', mood: 'mind' },
  { title: 'Barbie', year: 2023, tmdbId: 346698, emoji: '💖🩷', tagline: 'Life in plastic, fantastic.', mood: 'funny' },
  { title: 'Everything Everywhere All at Once', year: 2020, tmdbId: 545611, emoji: '🥯🫲', tagline: 'Nothing matters — in the best way possible.', mood: 'mind' },
  { title: 'Coco', year: 2017, tmdbId: 354912, emoji: '💀🎸', tagline: 'Remember me (and keep tissues nearby).', mood: 'feelgood' },
  { title: 'Inside Out', year: 2015, tmdbId: 150540, emoji: '😊😢', tagline: 'Meet the voices in your head.', mood: 'feelgood' },
  { title: 'WALL·E', year: 2008, tmdbId: 10681, emoji: '🤖🌱', tagline: 'He already waited 700 years. Keep him waiting?', mood: 'feelgood' },
  { title: 'Up', year: 2009, tmdbId: 14160, emoji: '🎈🏠', tagline: 'Adventure is out there!', mood: 'feelgood' },
  { title: 'Ratatouille', year: 2007, tmdbId: 2062, emoji: '🐭🍲', tagline: 'Anyone can cook — even a rat.', mood: 'feelgood' },
  { title: 'The Prestige', year: 2006, tmdbId: 1124, emoji: '🎩🐇', tagline: 'Are you watching closely?', mood: 'mind' },
  { title: 'Memento', year: 2000, tmdbId: 77, emoji: '📝🔁', tagline: 'Remember… wait, what were we doing?', mood: 'mind' },
  { title: 'The Departed', year: 2006, tmdbId: 1422, emoji: '🐀🚔', tagline: 'Keep your friends close. Watch the rat.', mood: 'action' },
  { title: 'Django Unchained', year: 2012, tmdbId: 68718, emoji: '🤠⛓️', tagline: 'The D is silent.', mood: 'action' },
  { title: 'Get Out', year: 2017, tmdbId: 419430, emoji: '🫖😱', tagline: 'Just a little bump in the night. Run.', mood: 'scary' },
  { title: 'Home Alone', year: 1990, tmdbId: 771, emoji: '🏠🪤', tagline: 'Keep the change, ya filthy animal.', mood: 'funny' },
  { title: 'The Big Lebowski', year: 1998, tmdbId: 115, emoji: '🎳🥃', tagline: 'The Dude abides.', mood: 'funny' },
  { title: 'Groundhog Day', year: 1993, tmdbId: 137, emoji: '🐹⏰', tagline: 'Same day, every day — forever. Or is it?', mood: 'funny' },
  { title: 'Hot Fuzz', year: 2007, tmdbId: 13365, emoji: '👮🦢', tagline: 'Swan! Have you seen this swan?', mood: 'funny' },
  { title: 'Shaun of the Dead', year: 2004, tmdbId: 742, emoji: '🧟🍵', tagline: "You've got red on you.", mood: 'funny' },
] as const;
