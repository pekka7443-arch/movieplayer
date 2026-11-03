'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light/dark theme"
      title="Toggle theme"
      className="size-9 max-md:size-10 shrink-0 text-zinc-500 hover:text-foreground hover:bg-white/5 dark:text-zinc-400 dark:hover:text-foreground dark:hover:bg-white/5"
      onClick={() => {
        // Read the live class so it works before the theme provider hydrates.
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(isDark ? 'light' : 'dark');
      }}
    >
      <Sun className="hidden size-[17px] dark:block" aria-hidden />
      <Moon className="size-[17px] dark:hidden" aria-hidden />
    </Button>
  );
}
