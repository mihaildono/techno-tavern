#!/usr/bin/env bash
# cron-fetch-news.sh — 3-hourly RSS feed fetcher for Techno Tavern
# Designed for Raspberry Pi cron

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "=== Fetching news feeds ==="

# Pull latest changes
git pull --rebase origin main || {
  log "⚠️ Git pull failed or had conflicts, attempting to continue..."
}

# Run RSS fetcher
if command -v npm >/dev/null 2>&1; then
  npm run fetch-news
else
  node news/fetch-news.js
fi

# Stage and commit if changed
git add news/data/news.json news/data/news-24h.json

if git diff --staged --quiet; then
  log "ℹ️ No new changes to commit."
else
  log "Committing changes..."
  git commit -m "chore(news): update news feed [skip ci]"
  log "Pushing to GitHub..."
  git push origin main
  log "✅ News feed successfully updated and pushed."
fi
