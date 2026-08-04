#!/usr/bin/env bash
set -euo pipefail

repo_url="${1:-https://github.com/aalibyrm/staj-v2.git}"
branch="${2:-main}"

command -v git >/dev/null 2>&1 || { echo "Git not found" >&2; exit 1; }
[[ -d .git ]] || git init
git branch -M "$branch"

if git remote get-url origin >/dev/null 2>&1; then
  current="$(git remote get-url origin)"
  [[ "$current" == "$repo_url" ]] || { echo "origin uses different URL: $current" >&2; exit 1; }
else
  git remote add origin "$repo_url"
fi

[[ -n "$(git config --get user.name || true)" ]] || { echo "Missing git user.name" >&2; exit 1; }
[[ -n "$(git config --get user.email || true)" ]] || { echo "Missing git user.email" >&2; exit 1; }

echo "Git connection ready"
echo "origin: $(git remote get-url origin)"
echo "branch: $(git branch --show-current)"
echo "Next in OMP: /adaptive-github-init"
