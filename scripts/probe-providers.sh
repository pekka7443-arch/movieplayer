#!/usr/bin/env bash
# Probe candidate embed providers (current pool + fresh candidates) from the sandbox.
# Reports HTTP status + latency + a body sniff so we can judge alive/dead.
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

probe() {
  local name="$1" url="$2"
  local out status ms body
  local started=$(date +%s%3N)
  status=$(curl -o /tmp/probe_body -s -m 8 -w "%{http_code}" -A "$UA" -H "Accept: text/html" -L "$url" 2>/dev/null)
  ms=$(( $(date +%s%3N) - started ))
  body=$(head -c 220 /tmp/probe_body 2>/dev/null | tr '\n' ' ' | sed 's/<[^>]*>//g' | cut -c1-110)
  printf "%-22s %-6s %6sms  %s\n" "$name" "$status" "$ms" "$body"
}

echo "=== CURRENT POOL ==="
probe "2embed.cc"      "https://www.2embed.cc/embed/tt0317219"
probe "2embed.skin"    "https://2embed.skin/embed/tt0317219"
probe "vidsrc.sh"      "https://vidsrc.sh/embed/movie/tt0317219"
probe "vidsrc.cc"      "https://vidsrc.cc/embed/movie/tt0317219"
probe "videasy.to"     "https://player.videasy.to/movie/imdb/tt0317219"
probe "videasy.net"    "https://player.videasy.net/movie/imdb/tt0317219"

echo ""
echo "=== FRESH CANDIDATES ==="
probe "vidsrc.nl"      "https://vidsrc.nl/embed/movie/tt0317219"
probe "vidsrc.su"      "https://vidsrc.su/embed/movie/tt0317219"
probe "vidsrc.in"      "https://vidsrc.in/embed/movie/tt0317219"
probe "vidlink.org"    "https://vidlink.org/movie/tt0317219"
probe "vidjoy.pro"     "https://vidjoy.pro/embed/movie/tt0317219"
probe "spencerdevs"    "https://spencerdevs.xyz/movie/tt0317219"
probe "embed.su"       "https://embed.su/embed/movie/tt0317219"
probe "superembed"     "https://multiembed.mov/?video_id=tt0317219"
probe "multiembed"     "https://multiembed.mov/?video_id=tt0317219"
probe "2embed.cc (vaihtoehto)" "https://www.2embed.cc/embedtt/tt0317219"
