import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { UxOverlay } from "@/components/site/ux-overlay";
import { installCsrfHeader } from "@/lib/csrf-client";

// CSRF double-submit: stamp x-csrf-token on every same-origin mutating fetch
// (transparent to all existing call sites — see src/lib/csrf-client.ts).
installCsrfHeader();

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Poster/backdrop CDNs — warm connections before the hero LCP image */}
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://assets.metahub.space" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <UxOverlay />
      </body>
    </html>
  );
}
