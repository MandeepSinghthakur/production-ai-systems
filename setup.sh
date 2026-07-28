#!/bin/sh
# One-time setup: replace the USERNAME placeholder and push.
#
#   ./setup.sh <your-github-username> [repo-name]
#
# Portable across macOS and Linux. `sed -i` differs between the two —
# BSD sed requires an argument, GNU sed forbids one — so this writes
# through a temp file instead and works on both.

set -eu

if [ $# -lt 1 ]; then
  echo "usage: ./setup.sh <github-username> [repo-name]" >&2
  exit 1
fi

USER_NAME="$1"
REPO_NAME="${2:-production-ai-systems}"

for f in mkdocs.yml book/index.md; do
  if [ ! -f "$f" ]; then
    echo "error: $f not found — are you in the repo root?" >&2
    echo "       expected files: mkdocs.yml, book/, examples/" >&2
    exit 1
  fi
  tmp="$(mktemp)"
  sed "s|USERNAME|$USER_NAME|g; s|production-ai-systems|$REPO_NAME|g" \
    "$f" > "$tmp"
  mv "$tmp" "$f"
  echo "updated $f"
done

# Verify the examples before publishing anything. Same check CI runs.
echo ""
echo "verifying chapter 18 lab..."
( cd examples/ch18-llm-gateway && node scripts/lab.mjs ) || {
  echo "lab failed — not pushing. Fix the example or the chapter." >&2
  exit 1
}

git add -A
git commit -q -m "Set repository URLs" || echo "(nothing to commit)"

echo ""
echo "Ready. To publish:"
echo ""
echo "  gh repo create $REPO_NAME --public --source=. --push"
echo ""
echo "Then: Settings -> Pages -> Source: GitHub Actions"
echo "Site: https://$USER_NAME.github.io/$REPO_NAME"
