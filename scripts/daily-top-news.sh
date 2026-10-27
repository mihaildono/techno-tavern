#!/usr/bin/env bash
# daily-top-news.sh — Pipeline for daily Bulgarian news summary in Techno Tavern
# Usage:
#   ./scripts/daily-top-news.sh prepare   # 1. Pull repo, fetch RSS, build news-digest.md
#   ./scripts/daily-top-news.sh finish    # 2. Validate top-news.json, reset archive, commit & push
#   ./scripts/daily-top-news.sh all       # Runs prepare, checks for top-news.json, and finishes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

step_prepare() {
  log "=== [1/2] Preparing news digest ==="

  log "Pulling latest changes from git..."
  git pull --rebase origin main || {
    log "⚠️ Git pull failed or had conflicts, continuing..."
  }

  if [[ ! -d node_modules/playwright ]]; then
    log "Installing npm dependencies (Playwright for social cards)..."
    # ci, not install: never rewrites package-lock.json, so git pull stays clean
    npm ci || log "⚠️ npm ci failed, social cards will be skipped"
  fi

  log "Fetching fresh RSS feeds..."
  npm run fetch-news

  log "Building compact news digest..."
  npm run news:digest

  if [[ ! -s "news/data/news-digest.md" ]]; then
    log "❌ Error: news/data/news-digest.md was not created or is empty."
    exit 1
  fi

  log "✅ news/data/news-digest.md is ready for AI summarization."
}

step_finish() {
  log "=== [2/2] Finalizing and committing news summary ==="

  if [[ ! -s "news/data/top-news.json" ]]; then
    log "❌ Error: news/data/top-news.json does not exist or is empty. Cannot finalize."
    exit 1
  fi

  log "Validating and normalising the AI output..."
  node news/news-daily.js clean

  log "Checking story links against the digest lines..."
  node news/news-daily.js links

  log "Archiving digest as a permanent page..."
  node news/news-daily.js archive

  log "Resetting 24h archive window..."
  npm run news:reset

  log "Writing the Discord message..."
  node news/news-daily.js discord

  log "Pre-rendering pages..."
  node scripts/build-pages.js

  log "Rendering social media cards..."
  node scripts/social-cards.js || log "⚠️ Social cards failed (non-fatal)"

  log "Staging files..."
  # Stage only paths that exist, so a missing optional output can't abort the commit
  for f in news/data/top-news.json news/data/news-24h.json news/data/news.json news/data/digests \
    index.html sitemap.xml news-sitemap.xml robots.txt feed.xml obzor blog/index.html; do
    if [[ -e "$f" ]]; then git add "$f"; fi
  done

  if git diff --staged --quiet; then
    log "ℹ️ No changes detected to commit."
  else
    log "Committing changes..."
    git commit -m "chore(news): update daily news summary [skip ci]"
    log "Pushing to GitHub..."
    git push origin main
    log "✅ Successfully pushed daily news summary to GitHub."
    node scripts/indexnow.js || log "⚠️ IndexNow ping failed (non-fatal)"
  fi

  # Posting the cards is a separate cron job (social-post.js --auto, own retries), see CRONS.md §3.

  log "=== Pipeline complete ==="
}

CMD="${1:-prepare}"

case "$CMD" in
  prepare)
    step_prepare
    ;;
  finish)
    step_finish
    ;;
  all)
    step_prepare
    log "ℹ️ Please run AI generation on news/data/news-digest.md -> news/data/top-news.json, then run './scripts/daily-top-news.sh finish'"
    ;;
  *)
    echo "Usage: $0 {prepare|finish|all}"
    exit 1
    ;;
esac
