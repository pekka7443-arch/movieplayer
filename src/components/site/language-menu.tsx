'use client';

import { Check, Globe2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { LANGUAGES, getLanguage } from '@/lib/languages';
import { useCinedeckStore } from '@/lib/store';

export function LanguageMenu() {
  const language = useCinedeckStore((s) => s.language);
  const setLanguage = useCinedeckStore((s) => s.setLanguage);
  const current = getLanguage(language);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`Content language: ${current.englishName}`}
          className="h-10 gap-2 px-3 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
        >
          <Globe2 className="size-4.5 text-amber-500 dark:text-amber-400" aria-hidden />
          <span className="hidden lg:inline text-sm">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[60] w-52 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
      >
        <DropdownMenuLabel className="text-xs font-medium tracking-wide text-zinc-500">
          Content language
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-200 dark:bg-zinc-800" />
        <div className="max-h-96 overflow-y-auto p-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
          {LANGUAGES.map((lang) => (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className="gap-2 rounded-md text-sm text-zinc-700 focus:text-zinc-900 focus:bg-zinc-200/80 aria-selected:bg-zinc-200/80 dark:text-zinc-300 dark:focus:text-zinc-100 dark:focus:bg-zinc-800/80 dark:aria-selected:bg-zinc-800/80"
              aria-selected={lang.code === language}
            >
              <span className="flex-1">{lang.label}</span>
              <span className="text-[10px] uppercase text-zinc-500 dark:text-zinc-600">{lang.code.slice(0, 2)}</span>
              {lang.code === language && <Check className="size-4 text-amber-500 dark:text-amber-400" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
