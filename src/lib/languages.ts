export interface Language {
  code: string;
  label: string;
  englishName: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en-US', label: 'English', englishName: 'English' },
  { code: 'es-ES', label: 'Español', englishName: 'Spanish' },
  { code: 'fr-FR', label: 'Français', englishName: 'French' },
  { code: 'de-DE', label: 'Deutsch', englishName: 'German' },
  { code: 'pt-BR', label: 'Português (Brasil)', englishName: 'Portuguese (Brazil)' },
  { code: 'it-IT', label: 'Italiano', englishName: 'Italian' },
  { code: 'hi-IN', label: 'हिन्दी', englishName: 'Hindi' },
  { code: 'ru-RU', label: 'Русский', englishName: 'Russian' },
  { code: 'ja-JP', label: '日本語', englishName: 'Japanese' },
  { code: 'ko-KR', label: '한국어', englishName: 'Korean' },
  { code: 'zh-CN', label: '中文', englishName: 'Chinese' },
  { code: 'ar-SA', label: 'العربية', englishName: 'Arabic' },
];

export const DEFAULT_LANGUAGE = 'en-US';

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

const IMG_BASE = 'https://image.tmdb.org/t/p';

/**
 * Build a TMDB CDN image URL. Returns null when the path is missing so
 * callers can render a placeholder instead.
 */
export function tmdbImg(
  path: string | null | undefined,
  size: 'w92' | 'w185' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500'
): string | null {
  if (!path) return null;
  return `${IMG_BASE}/${size}${path}`;
}
