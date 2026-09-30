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
  title: "CineDeck — Play movies & shows by TMDB ID",
  description:
    "Paste any TMDB ID and press play. CineDeck is a minimal, player-first movie & TV front-end with multiple streaming servers, watchlist, history, trailers and 12-language TMDB metadata.",
  keywords: [
    "CineDeck",
    "TMDB",
    "movie player",
    "TV shows",
    "stream player",
    "watch by ID",
    "trailers",
    "watchlist",
  ],
  authors: [{ name: "CineDeck" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CineDeck — Play anything with a TMDB ID",
    description: "Player-first movie & TV front-end. Paste a TMDB ID, pick a server, press play.",
    siteName: "CineDeck",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CineDeck — Play anything with a TMDB ID",
    description: "Player-first movie & TV front-end with servers, watchlist, history and trailers.",
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
