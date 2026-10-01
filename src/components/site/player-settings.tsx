'use client';

import { useState } from 'react';
import { SlidersHorizontal, Zap } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { updateSettings, useSettings, FAILOVER_SECONDS_MIN, FAILOVER_SECONDS_MAX } from '@/lib/settings';

/** Keyboard shortcuts available while the player is on screen. */
export const PLAYER_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'R', action: 'Reload the player' },
  { keys: 'S', action: 'Skip to next source' },
  { keys: 'T', action: 'Theater mode on / off' },
  { keys: 'N', action: 'Next episode' },
  { keys: 'P', action: 'Previous episode' },
];

/**
 * Playback settings popover — lives in the player toolbar so the user can
 * tune source-scan / failover behavior without opening global settings.
 * Everything persists to localStorage via CinedeckSettings.
 */
export function PlayerSettingsMenu() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Playback settings"
          title="Playback settings"
          className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        >
          <SlidersHorizontal className="size-3.5 text-brand" aria-hidden />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[60] w-80 rounded-xl border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Zap className="size-4 text-brand" aria-hidden />
          Playback
        </p>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-600">
          Saved automatically in your browser.
        </p>

        {/* Auto-pick healthiest source */}
        <div className="flex items-center justify-between gap-4 py-1.5">
          <div className="space-y-0.5">
            <Label htmlFor="pset-autopick" className="text-[13px] leading-tight">
              Auto-play healthiest source
            </Label>
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-600">
              Jump to the fastest mirror after each scan.
            </p>
          </div>
          <Switch
            id="pset-autopick"
            checked={settings.autoPickSource}
            onCheckedChange={(checked) => updateSettings({ autoPickSource: checked })}
            className="data-[state=checked]:bg-brand"
          />
        </div>

        {/* Auto-failover watchdog */}
        <div className="flex items-center justify-between gap-4 py-1.5">
          <div className="space-y-0.5">
            <Label htmlFor="pset-failover" className="text-[13px] leading-tight">
              Auto-failover
            </Label>
            <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-600">
              Switch sources automatically when one stalls.
            </p>
          </div>
          <Switch
            id="pset-failover"
            checked={settings.autoFailover}
            onCheckedChange={(checked) => updateSettings({ autoFailover: checked })}
            className="data-[state=checked]:bg-brand"
          />
        </div>

        {/* Failover timeout */}
        <div className={'space-y-2.5 py-1.5' + (settings.autoFailover ? '' : ' pointer-events-none opacity-40')}>
          <div className="flex items-center justify-between">
            <Label htmlFor="pset-timeout" className="text-[13px] leading-tight">
              Stall timeout
            </Label>
            <span className="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-brand">
              {settings.failoverSeconds}s
            </span>
          </div>
          <Slider
            id="pset-timeout"
            min={FAILOVER_SECONDS_MIN}
            max={FAILOVER_SECONDS_MAX}
            step={1}
            value={[settings.failoverSeconds]}
            onValueChange={([v]) => updateSettings({ failoverSeconds: v })}
            aria-label="Failover timeout in seconds"
            className="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-thumb]]:border-brand"
          />
        </div>

        <Separator className="my-2 bg-zinc-200 dark:bg-zinc-800/80" />

        {/* Keyboard shortcuts cheat-sheet */}
        <p className="mb-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
          Keyboard shortcuts
        </p>
        <ul className="space-y-1.5">
          {PLAYER_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
              <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-zinc-300 bg-zinc-100 px-1.5 font-mono text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {s.keys}
              </kbd>
              {s.action}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
