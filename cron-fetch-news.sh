#!/usr/bin/env bash
set -euo pipefail

REPO="/home/neuromancer/Personal/techno-tavern"
cd "$REPO"

echo "=== Techno Tavern cron-fetch-news ==="
echo "Start: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"

# 1. Pull latest changes from GitHub (rebase to keep history linear)
echo "--- git pull --rebase origin main ---"
git pull --rebase origin main

# 2. Fetch news from 9 RSS feeds (direct + Google News endpoints)
echo "--- node news/fetch-news.js ---"
node news/fetch-news.js

# 3. Commit and push updated news JSON files with [skip ci]
echo "--- git commit + push ---"
if [ -z "$(git status --porcelain --untracked-files=all)" ]; then
  echo "No changes to commit."
else
  git add cron-fetch-news.sh news/data/news.json news/data/news-24h.json
  git commit -m "Update news feeds [skip ci]"
  git push origin main
fi

echo "Done: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"