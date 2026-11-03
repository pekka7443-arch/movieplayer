/**
 * Fixed cinematic backdrop behind the entire app — deliberately static.
 *
 * The redesign replaced the animated aurora blobs, sweeping light shaft and
 * pointer spotlight with a single quiet layer: a faint top glow, a dark-mode
 * vignette and a static film-grain texture. Nothing here animates, nothing
 * reads browser state, and there is zero JavaScript — no hydration surface,
 * no repaint cost, no competition with poster artwork. Decorative only:
 * pointer-events-none, aria-hidden, -z-10.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Faint accent bloom from the top of the page */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_-8%,color-mix(in_srgb,var(--cinedeck-accent)_7%,transparent),transparent_58%)]" />
      {/* Static film grain — tactile texture, no motion */}
      <div className="cd-grain absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.05]" />
      {/* Vignette — dark mode only, pulls the eye to the content column */}
      <div className="absolute inset-0 hidden bg-[radial-gradient(95%_75%_at_50%_38%,transparent_55%,rgba(0,0,0,0.32)_100%)] dark:block" />
    </div>
  );
}
