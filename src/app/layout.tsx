import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { UxOverlay } from "@/components/site/ux-overlay";
import { CsrfInstall } from "@/components/site/csrf-install";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CineDeck — Movies, TV & Live Sports, one press away",
  description:
    "Search any title and press play — CineDeck scans every stream source and plays the healthiest one. Live sports with scores & replays, 13 auto-failover servers, watchlist, history, arcade and 12-language metadata. No API key needed.",
  keywords: [
    "CineDeck",
    "TMDB",
    "movie player",
    "TV shows",
    "live sports",
    "sports replays",
    "stream player",
    "watch online",
    "free sports TV",
    "trailers",
    "watchlist",
  ],
  authors: [{ name: "CineDeck" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CineDeck",
  },
  openGraph: {
    title: "CineDeck — Movies, TV & Live Sports, one press away",
    description:
      "Player-first streaming front-end: one-press search & play, live sports with replays you can scrub, 13 auto-failover servers.",
    siteName: "CineDeck",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CineDeck — Movies, TV & Live Sports",
    description:
      "One-press playback, live sports & replays, watchlist sync and zero ads.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0d",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP nonce from the proxy middleware (x-nonce request header). The meta
  // tag is React's documented mechanism: streamed SSR boundary-reveal scripts
  // pick the nonce up from here, so strict-dynamic CSP never blocks them.
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {nonce ? <meta property="csp-nonce" content={nonce} /> : null}
        {/* Theme bootstrap — applies the stored dark/light class BEFORE first
            paint (no FOUC). It lives here in the server-rendered head instead
            of inside a React component: React 19 never executes scripts
            created during client rendering, so an in-component script both
            warns ("Encountered a script tag while rendering React
            component") and dies on client navigations. The nonce lets the
            strict-dynamic production CSP run it. Semantics mirror what
            next-themes did (storage key "theme", class attribute, dark
            default) — see src/lib/theme.tsx. */}
        <script
          nonce={nonce || undefined}
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t==='light'?'light':'dark';var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(d);e.style.colorScheme=d}catch(e){}})()",
          }}
        />
        {/* Poster/backdrop CDNs — warm connections before the hero LCP image */}
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://assets.metahub.space" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <CsrfInstall />
        <UxOverlay />
      </body>
    </html>
  );
}
