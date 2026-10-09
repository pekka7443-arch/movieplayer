#!/usr/bin/env bash
# Persistent detached starter for the CineDeck dev server (platform preview :3000).
#
# WHY: tool-session spawns get reaped when the calling shell is torn down.
# A wrapper script that spawns the server in a subshell, disowns it, and
# exits cleanly lets the daemon reparent to PID 1 (tini) and SURVIVE —
# same trick .zscripts/dev.sh uses with its `bun run dev &` + `unset DEV_PID`.
#
# Idempotent: exits 0 immediately if :3000 already serves.
set -u

PORT="${PORT:-3000}"
if curl -s -o /dev/null -m 3 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
  echo "already serving on :${PORT} — nothing to do"
  exit 0
fi

cd /home/z/my-project
( NEXT_DEV_DIST_DIR=.next-dev bun run dev ) < /dev/null >> dev.log 2>&1 &
disown $! 2>/dev/null
exit 0
