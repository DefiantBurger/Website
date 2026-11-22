#!/usr/bin/env bash
# Checks that the docs' relative links and #anchors resolve, and that doc names
# mentioned anywhere in the repo (NAME.md, NAME.md#anchor, or "Heading" in NAME.md,
# as code comments do) still exist. Exits 1 and lists each broken reference.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

exec python3 -I - <<'EOF'
import re
import subprocess
import sys
from pathlib import Path

def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True).stdout.splitlines()

# Tracked plus new untracked files, so a doc counts before it's committed.
md_files = [Path(f) for f in git('ls-files', '-co', '--exclude-standard', '*.md') if Path(f).exists()]
# CLAUDE.md is kept out of git (.git/info/exclude) but cites docs too, so check it when present.
LOCAL = [f for f in [Path('CLAUDE.md')] if f.exists()]
md_files += LOCAL
by_name = {}
for f in md_files:
    by_name.setdefault(f.name, []).append(f)

def outside_fences(path):
    fence = None
    for n, line in enumerate(path.read_text().splitlines(), 1):
        m = re.match(r'\s*(`{3,}|~{3,})', line)
        if m and (fence is None or m.group(1).startswith(fence)):
            fence = m.group(1) if fence is None else None
        elif fence is None:
            yield n, line

def slug(heading):
    # GitHub's rule: lowercase, drop punctuation, each space becomes a hyphen.
    heading = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', heading)
    return re.sub(r'[^\w\- ]', '', heading.strip().lower()).replace(' ', '-')

anchor_cache = {}
def anchors(path):
    key = path.resolve()
    if key not in anchor_cache:
        seen, found = {}, set()
        for _, line in outside_fences(path):
            m = re.match(r'#{1,6}\s+(.+?)\s*#*\s*$', line)
            if m:
                s = slug(m.group(1))
                found.add(f'{s}-{seen[s]}' if s in seen else s)
                seen[s] = seen.get(s, 0) + 1
        anchor_cache[key] = found
    return anchor_cache[key]

def has_anchor(name, anchor):
    return any(anchor in anchors(f) for f in by_name.get(name, []))

errors = set()

# 1. Relative links in the docs. Project write-ups are skipped: on the site their links are routes.
for doc in md_files:
    if doc.parts[:3] == ('frontend', 'src', 'content'):
        continue
    for n, line in outside_fences(doc):
        for target in re.findall(r'\]\(([^)\s]+)\)', re.sub(r'`[^`]*`', '', line)):
            if re.match(r'[a-z][a-z0-9+.-]*:', target):
                continue
            path, _, anchor = target.partition('#')
            dest = doc.parent / path if path else doc
            if not dest.exists():
                errors.add(f'{doc}:{n}: {target}: no such file')
            elif anchor and dest.suffix == '.md' and anchor not in anchors(dest):
                errors.add(f'{doc}:{n}: {target}: no such heading')

# 2. Doc names and headings mentioned anywhere, code comments included.
NAME = re.compile(r'\b([A-Z][A-Z_-]*\.md)(?:#([\w-]+))?')
OLD_NAMES = {'KNOWN-ISSUES.md'}  # cited on purpose in CLAUDE.md's commit message examples
QUOTED = re.compile(r'\\?"([^"\\]+)\\?" in (?:[\w./-]*/)?([A-Z][A-Z_-]*\.md)')
hits = git('grep', '--untracked', '-nIE', r'[A-Z][A-Z_-]*\.md', '--', '.', ':!doc-test.sh')
hits += [f'{f}:{n}:{line}' for f in LOCAL for n, line in enumerate(f.read_text().splitlines(), 1)]
for hit in hits:
    file, n, text = hit.split(':', 2)
    if file.endswith('.md'):
        text = re.sub(r'\]\([^)]*\)', ']', text)  # link targets were checked above
    for name, anchor in NAME.findall(text):
        if name in OLD_NAMES or (name == 'CLAUDE.md' and not LOCAL):
            continue  # a fresh clone has no CLAUDE.md
        if name not in by_name:
            errors.add(f'{file}:{n}: {name}: no such doc')
        elif anchor and not has_anchor(name, anchor):
            errors.add(f'{file}:{n}: {name}#{anchor}: no such heading')
    for heading, name in QUOTED.findall(text):
        if name in by_name and not has_anchor(name, slug(heading)):
            errors.add(f'{file}:{n}: "{heading}" in {name}: no such heading')

for e in sorted(errors):
    print(e)
if errors:
    sys.exit(1)
print(f'doc links OK ({len(md_files)} Markdown files)')
EOF
