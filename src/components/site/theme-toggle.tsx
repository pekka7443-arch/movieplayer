'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light/dark theme"
      title="Toggle theme"
      className="size-10 shrink-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
      onClick={() => {
        // Read the live class so it works before next-themes hydrates.
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(isDark ? 'light' : 'dark');
      }}
    >
      <Sun className="hidden size-4.5 dark:block" aria-hidden />
      <Moon className="size-4.5 dark:hidden" aria-hidden />
    </Button>
  );
}
