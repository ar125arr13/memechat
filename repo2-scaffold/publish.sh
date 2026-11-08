#!/usr/bin/env bash
# Push repo2-scaffold as the initial commit of the NEW GitHub repo.
# Run ONLY after the target GitHub repo exists AND this connection has write access to it.
set -euo pipefail
REMOTE="${1:-https://github.com/zahradavoodi69-code/memechat-dataa.git}"
SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git init -q -b main "$WORK"
cp "$SRC/README.md" "$SRC/.gitignore" "$WORK/"
mkdir -p "$WORK/docs"
cp "$SRC/docs/PLAN.md" "$WORK/docs/"
cd "$WORK"
git add -A
git -c user.name="Arena Agent" -c user.email="agent@arena.ai" \
  commit -q -m "MemeChat second repo: encrypted archive / static blob destination (no secrets, no user data)"
git remote add origin "$REMOTE"
git push -u origin main
echo "Pushed -> $REMOTE"
echo "Verify: gh repo view ar125arr13/memechat-data"
