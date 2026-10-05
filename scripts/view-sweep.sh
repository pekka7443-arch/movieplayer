#!/bin/bash
# Phase 1.6 — sweep every CineDeck view on desktop + 390px mobile,
# collecting page errors and console errors per view.
set -u
BASE="http://localhost:3000"
VIEWS=(
  "/"
  "/?s=inception"
  "/?id=27205&type=movie"
  "/?id=1396&type=tv"
  "/?view=sports"
  "/?view=stats"
  "/?view=admin"
  "/?genre=28"
)
report=/tmp/view-sweep.txt
: > "$report"

for W in "1280 800 desktop" "390 844 mobile"; do
  set -- $W
  WIDTH=$1; HEIGHT=$2; LABEL=$3
  echo "=== $LABEL ${WIDTH}x${HEIGHT} ===" >> "$report"
  agent-browser set viewport $WIDTH $HEIGHT >/dev/null 2>&1
  for V in "${VIEWS[@]}"; do
    agent-browser open "$BASE$V" >/dev/null 2>&1
    agent-browser wait --load networkidle >/dev/null 2>&1
    sleep 1.2
    PERR=$(agent-browser errors 2>/dev/null | grep -v "✓\|No page errors\|^$" | head -3)
    CERR=$(agent-browser console 2>/dev/null | grep -iE "\[error\]|uncaught|hydration" | head -3)
    TITLE=$(agent-browser get title 2>/dev/null | head -c 40)
    if [ -z "$PERR" ] && [ -z "$CERR" ]; then
      echo "OK   $V  ($TITLE)" >> "$report"
    else
      echo "ERR  $V" >> "$report"
      [ -n "$PERR" ] && echo "     page: $PERR" >> "$report"
      [ -n "$CERR" ] && echo "     console: $CERR" >> "$report"
    fi
  done
done
cat "$report"
