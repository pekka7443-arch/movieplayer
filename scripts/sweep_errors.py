#!/usr/bin/env python3
"""Phase 1 sweep: standardize API error shape to { error: { code, message } }.

Transforms:
  Response.json({ error: 'code' }, { status: 400 })
    -> apiError(400, 'code')
  NextResponse.json({ error: "code" }, { status: 400 })
    -> apiError(400, 'code')
  Response.json({ error: 'weak_password', problems: verdict.problems }, { status: 400 })
    -> apiError(400, 'weak_password', undefined, { problems: verdict.problems })
Adds/extends the `@/lib/server/api` import per file. Idempotent.
"""
import re
import sys
from pathlib import Path

ROOT = Path('/home/z/my-project/src/app/api')

# Matches: Response.json({ error: 'code' }, { status: 400 })
PLAIN = re.compile(
    r"(?:Next)?Response\.json\(\s*\{\s*error:\s*(['\"])(?P<code>[a-z0-9_]+)\1\s*\}\s*,\s*\{\s*status:\s*(?P<status>\d+)\s*\}\s*\)"
)
# Matches dynamic-status variant: { status } or { status: var }
PLAIN_DYN = re.compile(
    r"(?:Next)?Response\.json\(\s*\{\s*error:\s*(['\"])(?P<code>[a-z0-9_]+)\1\s*\}\s*,\s*\{\s*status:\s*(?P<status>[a-zA-Z_][\w.]*)\s*\}\s*\)"
)
# Matches extra-field variant: { error: 'code', field: expr }, { status: N }
EXTRA = re.compile(
    r"(?:Next)?Response\.json\(\s*\{\s*error:\s*(['\"])(?P<code>[a-z0-9_]+)\1\s*,\s*(?P<field>[a-zA-Z_]\w*):\s*(?P<expr>[^}]+?)\s*\}\s*,\s*\{\s*status:\s*(?P<status>\d+)\s*\}\s*\)"
)
# Message-as-code variant e.g. 'type must be movie|tv'
MSGCODE = re.compile(
    r"(?:Next)?Response\.json\(\s*\{\s*error:\s*(['\"])(?P<code>[^'\"]+)\1\s*\}\s*,\s*\{\s*status:\s*(?P<status>\d+)\s*\}\s*\)"
)

def slugify(msg: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", msg.lower()).strip("_")
    return s or "bad_request"

changed_files = 0
total = 0

for path in sorted(ROOT.rglob("route.ts")):
    src = path.read_text()
    orig = src

    def repl_extra(m: re.Match) -> str:
        return f"apiError({m.group('status')}, '{m.group('code')}', undefined, {{ {m.group('field')}: {m.group('expr')} }})"

    def repl_plain(m: re.Match) -> str:
        return f"apiError({m.group('status')}, '{m.group('code')}')"

    def repl_dyn(m: re.Match) -> str:
        return f"apiError({m.group('status')}, '{m.group('code')}')"

    def repl_msgcode(m: re.Match) -> str:
        code = m.group('code')
        # real slug codes pass through; message-like strings become bad_request + message
        if re.fullmatch(r"[a-z0-9_]+", code):
            return repl_plain(m)
        return f"apiError({m.group('status')}, 'bad_request', {code!r})"

    # order matters: EXTRA before PLAIN (EXTRA is a superset shape)
    src = EXTRA.sub(repl_extra, src)
    src = PLAIN.sub(repl_plain, src)
    src = PLAIN_DYN.sub(repl_dyn, src)
    src = MSGCODE.sub(repl_msgcode, src)

    if src != orig:
        n = len(EXTRA.findall(orig)) + len(PLAIN.findall(orig)) + len(PLAIN_DYN.findall(orig)) + len(MSGCODE.findall(orig))
        total += n
        # import handling
        if re.search(r"import\s*\{[^}]*\bapiError\b[^}]*\}\s*from\s*'@/lib/server/api'", src):
            pass
        elif re.search(r"import\s*\{([^}]*)\}\s*from\s*'@/lib/server/api'", src):
            src = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'@/lib/server/api'",
                         lambda m: f"import {{ {m.group(1).strip().rstrip(',')}, apiError }} from '@/lib/server/api'", src, count=1)
            # dedupe possible double comma space artifacts
            src = re.sub(r",\s*,", ",", src)
        elif re.search(r'import\s*\{([^}]*)\}\s*from\s*"@/lib/server/api"', src):
            src = re.sub(r'import\s*\{([^}]*)\}\s*from\s*"@/lib/server/api"',
                         lambda m: f'import {{ {m.group(1).strip().rstrip(",")}, apiError }} from "@/lib/server/api"', src, count=1)
        else:
            # insert a new import after the last existing import line
            lines = src.split("\n")
            last_import = max((i for i, l in enumerate(lines) if l.startswith("import ")), default=-1)
            lines.insert(last_import + 1, "import { apiError } from '@/lib/server/api';")
            src = "\n".join(lines)
        path.write_text(src)
        changed_files += 1
        print(f"{path.relative_to(ROOT.parent.parent.parent)}: ~{n} site(s)")

print(f"\n{changed_files} files changed, ~{total} error sites normalized")
sys.exit(0)
