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
          className="h-9 gap-1.5 px-2 max-md:h-10 max-md:px-3 text-zinc-500 hover:text-foreground hover:bg-white/5 dark:text-zinc-400 dark:hover:text-foreground dark:hover:bg-white/5"
        >
          <Globe2 className="size-[17px]" aria-hidden />
          <span className="hidden lg:inline text-[13px]">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[60] w-52"
      >
        <DropdownMenuLabel className="text-xs font-medium tracking-wide text-muted-foreground">
          Content language
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto p-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700">
          {LANGUAGES.map((lang) => (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className="gap-2 rounded-md text-sm text-zinc-700 focus:text-zinc-900 focus:bg-zinc-200/80 aria-selected:bg-zinc-200/80 dark:text-zinc-300 dark:focus:text-zinc-100 dark:focus:bg-zinc-800/80 dark:aria-selected:bg-zinc-800/80"
              aria-selected={lang.code === language}
            >
              <span className="flex-1">{lang.label}</span>
              <span className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">{lang.code.slice(0, 2)}</span>
              {lang.code === language && <Check className="size-4 text-brand" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
