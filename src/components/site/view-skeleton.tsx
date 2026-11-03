'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-view loading fallbacks for the code-split views in page.tsx —
 * matched to each view's real shape so switching views never jumps.
 */
export function ViewSkeleton({ kind }: { kind: 'watch' | 'rows' | 'stats' }) {
  if (kind === 'watch') {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-hidden>
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-md" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
          </div>
          <div className="space-y-4">
            <Skeleton className="aspect-[2/3] w-44 rounded-lg" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-5/6 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'stats') {
    return (
      <div className="space-y-6" aria-hidden>
        <Skeleton className="h-9 w-64 rounded-md" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  // rows — horizontally scrolling poster rows (sports / shared list)
  return (
    <div className="space-y-7" aria-hidden>
      <Skeleton className="h-8 w-52 rounded-md" />
      {[0, 1].map((row) => (
        <div key={row} className="space-y-3">
          <Skeleton className="h-5 w-36 rounded-md" />
          <div className="flex gap-2.5 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] w-[118px] shrink-0 rounded-lg sm:w-[140px] md:w-[150px] lg:w-[156px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
