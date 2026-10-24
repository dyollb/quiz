#!/usr/bin/env bash
# Ship the current branch to production: push, open a PR if none exists, and
# arm auto-merge. GitHub Actions runs the tests + build; when they pass the PR
# merges to main and GitHub Pages redeploys automatically.
#
#   git checkout -b my-change && ... && git commit
#   ./scripts/ship.sh
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git branch --show-current)
if [[ -z "$branch" || "$branch" == main ]]; then
  echo "ship.sh: run this from a feature branch (currently: ${branch:-detached HEAD})" >&2
  exit 1
fi

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "ship.sh: tracked files have uncommitted changes — commit them first (or stash)" >&2
  exit 1
fi

git push -u origin "$branch"

if ! gh pr view --json number >/dev/null 2>&1; then
  # --fill derives title/body from the single commit; fall back for multi-commit branches.
  gh pr create --fill 2>/dev/null ||
    gh pr create --title "Merge $branch" --body "Shipped from \`$branch\` via scripts/ship.sh."
fi

gh pr merge --auto --squash "$branch"
echo "Auto-merge armed — Pages redeploys once checks pass: https://dyollb.github.io/quiz/"
