'use client';

/**
 * Legal & contact view (/?view=legal) — Privacy Policy, Terms of Service
 * and Contact, written to match what CineDeck actually does: essential
 * storage only, no trackers, third-party metadata/stream sources.
 */

const SECTIONS = [
  {
    id: 'privacy',
    title: 'Privacy Policy',
    body: [
      'CineDeck stores the minimum needed to run your account: an email address, a scrypt-hashed password, session records (with IP/geo summary for security) and your library data — watchlist, history, ratings, notes and lists. Watch progress is a wall-clock counter, not a tracking pixel.',
      'We run no third-party analytics and load no ad trackers. Metadata (posters, facts) is fetched server-side from TMDB/Cinemeta/TVmaze, so those providers see CineDeck\'s server, not your browser. Sports schedules come from ESPN/TheSportsDB and channels from the iptv-org playlist.',
      'You can export or permanently delete everything from Settings → Account at any time; deletion runs immediately and removes sessions, library and profile rows.',
    ],
  },
  {
    id: 'terms',
    title: 'Terms of Service',
    body: [
      'CineDeck is a personal-use front-end. It does not host video: playback uses third-party embed providers, and CineDeck scans their health to pick a working source. Availability, quality and legality of any specific source depend on that provider and your jurisdiction — you are responsible for what you stream.',
      'Accounts are free, one per person, with a 3-device session cap for admins. Abuse (scraping, automated bulk access, attacking the service or other members) leads to suspension.',
      'The service is provided as-is, without warranties. Features can change or end; your library data stays exportable.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [
      'Bug reports, feature ideas and account issues: reach the operator through the in-app feedback channels or the platform this deployment runs on. Security-sensitive findings are welcome — include reproduction steps and avoid automated scanning against the live service.',
    ],
  },
] as const;

export function LegalView() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-2">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Privacy, Terms &amp; Contact
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The short version: essential storage only, no trackers, no hosted video.
        </p>
      </header>
      {SECTIONS.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`legal-${section.id}`}>
          <h2 id={`legal-${section.id}`} className="flex items-center gap-2 text-xl font-semibold tracking-tight md:text-2xl">
            <span className="h-5 w-1 rounded-full bg-brand" aria-hidden />
            {section.title}
          </h2>
          <div className="mt-3 space-y-3">
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-[15px] leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
