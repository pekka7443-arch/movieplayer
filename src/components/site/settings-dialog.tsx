'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2, Settings2, Trash2 } from 'lucide-react';
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
import { clearTmdbKey, getTmdbKey, setTmdbKey, updateSettings, useHasTmdbKey, useSettings } from '@/lib/settings';
import { useCinedeckStore } from '@/lib/store';
import { useClearHistory, useClearWatchlist } from '@/hooks/use-media';

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
    <DialogContent className="z-[70] max-w-md gap-5 border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="size-5 text-amber-400" aria-hidden />
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
            <KeyRound className="size-4 text-amber-400" aria-hidden />
            TMDB API key
          </Label>
          <span
            className={
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ' +
              (hasKey ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400')
            }
          >
            <span
              className={
                'size-1.5 rounded-full ' +
                (hasKey ? 'bg-emerald-400' : 'animate-pulse bg-amber-400')
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
              className="h-10 rounded-lg border-zinc-800 bg-zinc-900/70 pr-10 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20"
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button
            type="button"
            onClick={saveKey}
            disabled={saving}
            className="h-10 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Save'}
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-600">
          Free at{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-amber-400/90 underline-offset-2 hover:underline"
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
            className="h-8 rounded-lg border-zinc-800 bg-transparent text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove key
          </Button>
        )}
      </section>

      <Separator className="bg-zinc-800/80" />

      {/* Language */}
      <section aria-labelledby="settings-language" className="space-y-2.5">
        <Label htmlFor="language-select" className="text-sm font-medium" id="settings-language">
          Language
        </Label>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger
            id="language-select"
            className="h-10 w-full rounded-lg border-zinc-800 bg-zinc-900/70 text-sm text-zinc-200 focus-visible:ring-amber-400/20"
          >
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent className="z-[70] max-h-72 border-zinc-800 bg-zinc-900/95 backdrop-blur">
            {LANGUAGES.map((lang) => (
              <SelectItem
                key={lang.code}
                value={lang.code}
                className="focus:bg-zinc-800/80 focus:text-zinc-100"
              >
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-zinc-600">
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
            className="data-[state=checked]:bg-amber-400"
          />
        </div>
        <p className="text-xs text-zinc-600">
          Tracks what you watch so you can continue where you left off.
        </p>
      </section>

      <Separator className="bg-zinc-800/80" />

      {/* Danger zone */}
      <section aria-labelledby="settings-danger" className="space-y-2.5">
        <p id="settings-danger" className="text-sm font-medium text-red-400">
          Danger zone
        </p>
        <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-lg border-zinc-800 bg-transparent text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="z-[70] max-w-sm border-zinc-800 bg-zinc-950 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear watch history?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-500">
                  This removes every entry from “Continue watching”. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-lg border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
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
                className="h-9 rounded-lg border-zinc-800 bg-transparent text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Clear My List
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="z-[70] max-w-sm border-zinc-800 bg-zinc-950 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear your watchlist?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-500">
                  This removes every saved title from “My List”. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-lg border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
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
