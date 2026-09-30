'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function TrailerDialog({
  trailerKey,
  title,
  open,
  onOpenChange,
}: {
  trailerKey: string | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!trailerKey) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[70] max-w-3xl gap-0 border-zinc-800 bg-zinc-950 p-3 sm:p-4">
        <DialogHeader className="px-1 pb-3">
          <DialogTitle className="text-base text-zinc-100">
            {title} — Official trailer
          </DialogTitle>
          <DialogDescription className="sr-only">
            Plays the official trailer from YouTube.
          </DialogDescription>
        </DialogHeader>
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <iframe
            key={trailerKey}
            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1`}
            title={`${title} trailer`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="size-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
