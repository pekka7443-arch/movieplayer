import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
