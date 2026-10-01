'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2, Palette, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { LANGUAGES } from '@/lib/languages';
import { applyAccentColor, clearTmdbKey, getTmdbKey, setTmdbKey, updateSettings, useHasTmdbKey, useSettings } from '@/lib/settings';
import { useCinedeckStore } from '@/lib/store';
import { useClearHistory, useClearWatchlist } from '@/hooks/use-media';

/** Curated palette of preset accent colors — every one is bright enough to
 * pair with the dark zinc-950 text we use as foreground. */
const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Amber', value: '#fbbf24' },
  { name: 'Sunset', value: '#fb923c' },
  { name: 'Coral', value: '#f87171' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Violet', value: '#c084fc' },
  { name: 'Indigo', value: '#818cf8' },
  { name: 'Ocean', value: '#38bdf8' },
  { name: 'Mint', value: '#34d399' },
  { name: 'Lime', value: '#a3e635' },
  { name: 'Sand', value: '#d4b896' },
];

/**
 * Inner body — mounted only while the dialog is open, so its local state
 * (key draft / visibility) resets naturally on every open.
 */
function SettingsBody() {
  const language = useCinedeckStore((s) => s.language);
  const setLanguage = useCinedeckStore((s) => s.setLanguage);

  const settings = useSettings();
  const hasKey = useHasTmdbKey();
  const queryClient = useQueryClient();

  const [keyDraft, setKeyDraft] = useState(() => getTmdbKey());
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const clearHistory = useClearHistory();
  const clearWatchlist = useClearWatchlist();

  const saveKey = () => {
    const value = keyDraft.trim();
    if (!value) {
      toast.error('Paste a TMDB API key first');
      return;
    }
    setSaving(true);
    setTmdbKey(value);
    // Invalidate every query so TMDB metadata refetches with the new key.
    queryClient.invalidateQueries();
    window.setTimeout(() => {
      setSaving(false);
      toast.success('Key saved', {
        description: 'Search, trending and metadata are now unlocked.',
      });
    }, 250);
  };

  const removeKey = () => {
    clearTmdbKey();
    setKeyDraft('');
    queryClient.invalidateQueries();
    toast('API key removed', {
      description: 'CineDeck is back to player-only mode.',
    });
  };

  const onClearHistory = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => toast.success('Watch history cleared'),
      onError: () => toast.error('Could not clear history'),
    });
  };

  const onClearWatchlist = () => {
    clearWatchlist.mutate(undefined, {
      onSuccess: () => toast.success('My List cleared'),
      onError: () => toast.error('Could not clear My List'),
    });
  };

  return (
    <DialogContent className="z-[70] max-w-md gap-5 border-zinc-200 bg-white p-6 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="size-5 text-brand" aria-hidden />
          Settings
        </DialogTitle>
        <DialogDescription className="text-sm text-zinc-500">
          Everything is stored locally in your browser.
        </DialogDescription>
      </DialogHeader>

      {/* TMDB API key */}
      <section aria-labelledby="settings-tmdb-key" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="tmdb-key-input" className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4 text-brand" aria-hidden />
            TMDB API key
          </Label>
          <span
            className={
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ' +
              (hasKey
                ? 'bg-emerald-400/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-brand-soft text-brand')
            }
          >
            <span
              className={
                'size-1.5 rounded-full ' +
                (hasKey ? 'bg-emerald-400' : 'animate-pulse bg-brand')
              }
              aria-hidden
            />
            {hasKey ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="tmdb-key-input"
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Paste your v3 API key"
              autoComplete="off"
              spellCheck={false}
              className="h-10 rounded-lg border-zinc-200 bg-white/80 pr-10 font-mono text-sm text-zinc-800 placeholder:text-zinc-400 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:placeholder:text-zinc-600"
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 transition-colors hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:text-zinc-200"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button
            type="button"
            onClick={saveKey}
            disabled={saving}
            className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Save'}
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-600">
          Free at{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-brand/90 underline-offset-2 hover:underline dark:text-brand/90"
          >
            themoviedb.org
          </a>{' '}
          → Settings → API. Stored only in your browser.
        </p>

        {hasKey && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={removeKey}
            className="h-8 rounded-lg border-zinc-200 bg-transparent text-xs text-red-600 hover:bg-red-500/10 hover:text-red-500 dark:border-zinc-800 dark:text-red-400 dark:hover:text-red-300"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove key
          </Button>
        )}
      </section>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />

      {/* Accent color — live-preview palette + custom hex input */}
      <section aria-labelledby="settings-accent" className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="size-4 text-brand" aria-hidden />
          <Label className="text-sm font-medium" id="settings-accent">
            Accent color
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const selected = settings.accentColor.toLowerCase() === preset.value.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                aria-label={`${preset.name} ${selected ? '(selected)' : ''}`}
                aria-pressed={selected}
                title={preset.name}
                onClick={() => {
                  updateSettings({ accentColor: preset.value });
                  applyAccentColor(preset.value);
                  toast.success(`${preset.name} accent`, {
                    description: 'All brand colors updated live.',
                  });
                }}
                className={
                  'size-8 rounded-full ring-2 ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-zinc-950 ' +
                  (selected ? 'ring-zinc-900 dark:ring-white' : 'ring-transparent')
                }
                style={{ backgroundColor: preset.value }}
              />
            );
          })}
          {/* Custom color input — native color picker for full freedom */}
          <label
            className="relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-zinc-300 ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-zinc-700 dark:ring-offset-zinc-950"
            title="Custom color"
            aria-label="Pick a custom accent color"
          >
            { }
            <img
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='13.5' cy='6.5' r='.5' fill='%23999'/%3E%3Ccircle cx='17.5' cy='10.5' r='.5' fill='%23999'/%3E%3Ccircle cx='8.5' cy='7.5' r='.5' fill='%23999'/%3E%3Ccircle cx='6.5' cy='12.5' r='.5' fill='%23999'/%3E%3Cpath d='M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.052 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z'/%3E%3C/svg%3E"
              alt=""
              width={14}
              height={14}
              className="absolute inset-0 m-auto opacity-60"
              aria-hidden
            />
            <input
              type="color"
              value={settings.accentColor}
              onChange={(e) => {
                const value = e.target.value;
                updateSettings({ accentColor: value });
                applyAccentColor(value);
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              aria-label="Pick a custom accent color"
            />
          </label>
        </div>
        {/* Hex text input — for typing an exact value */}
        <div className="flex items-center gap-2">
          <Input
            value={settings.accentColor}
            onChange={(e) => {
              const value = e.target.value.trim();
              if (!/^#([0-9a-fA-F]{0,6})$/.test(value)) return;
              updateSettings({ accentColor: value });
              if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
                applyAccentColor(value);
              }
            }}
            className="h-9 w-32 rounded-lg border-zinc-200 bg-white/80 font-mono text-sm text-zinc-800 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
            placeholder="#fbbf24"
            aria-label="Accent color hex value"
          />
          <button
            type="button"
            onClick={() => {
              updateSettings({ accentColor: '#fbbf24' });
              applyAccentColor('#fbbf24');
              toast('Accent reset to amber', { description: 'Back to the default brand color.' });
            }}
            className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-brand hover:underline"
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-600">
          Recolors the logo, buttons, links, active tabs and highlights across the entire app — live.
        </p>
      </section>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />

      {/* Language */}
      <section aria-labelledby="settings-language" className="space-y-2.5">
        <Label htmlFor="language-select" className="text-sm font-medium" id="settings-language">
          Language
        </Label>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger
            id="language-select"
            className="h-10 w-full rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
          >
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent className="z-[70] max-h-72 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            {LANGUAGES.map((lang) => (
              <SelectItem
                key={lang.code}
                value={lang.code}
                className="focus:bg-zinc-200/80 focus:text-zinc-900 dark:focus:bg-zinc-800/80 dark:focus:text-zinc-100"
              >
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-zinc-500 dark:text-zinc-600">
          Applies to titles, overviews and other TMDB metadata.
        </p>
      </section>

      {/* History */}
      <section aria-labelledby="settings-history" className="space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="history-switch" className="text-sm font-medium">
            Save watch history
          </Label>
          <Switch
            id="history-switch"
            checked={settings.saveHistory}
            onCheckedChange={(checked) => updateSettings({ saveHistory: checked })}
            aria-label="Save watch history"
            className="data-[state=checked]:bg-brand"
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-600">
          Tracks what you watch so you can continue where you left off.
        </p>
      </section>

      <Separator className="bg-zinc-200 dark:bg-zinc-800/80" />

      {/* Danger zone */}
      <section aria-labelledby="settings-danger" className="space-y-2.5">
        <p id="settings-danger" className="text-sm font-medium text-red-600 dark:text-red-400">
          Danger zone
        </p>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-lg border-zinc-200 bg-transparent text-xs text-red-600 hover:bg-red-500/10 hover:text-red-500 dark:border-zinc-800 dark:text-red-400 dark:hover:text-red-300"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="z-[70] max-w-sm border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear watch history?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-500 dark:text-zinc-500">
                  This removes every entry from “Continue watching”. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-lg border-zinc-200 bg-transparent text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClearHistory}
                  className="rounded-lg bg-red-500 text-white hover:bg-red-400"
                >
                  Clear history
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-lg border-zinc-200 bg-transparent text-xs text-red-600 hover:bg-red-500/10 hover:text-red-500 dark:border-zinc-800 dark:text-red-400 dark:hover:text-red-300"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Clear My List
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="z-[70] max-w-sm border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear your watchlist?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-500 dark:text-zinc-500">
                  This removes every saved title from “My List”. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-lg border-zinc-200 bg-transparent text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClearWatchlist}
                  className="rounded-lg bg-red-500 text-white hover:bg-red-400"
                >
                  Clear My List
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </DialogContent>
  );
}

export function SettingsDialog() {
  const open = useCinedeckStore((s) => s.settingsOpen);
  const closeSettings = useCinedeckStore((s) => s.closeSettings);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : closeSettings())}>
      {open && <SettingsBody />}
    </Dialog>
  );
}
