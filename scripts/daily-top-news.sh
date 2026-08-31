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

  # Validate JSON format
  if command -v node >/dev/null 2>&1; then
    node -e '
      const data = JSON.parse(require("fs").readFileSync("news/data/top-news.json", "utf8"));
      if (!data.overview || !Array.isArray(data.stories) || data.stories.length === 0) {
        console.error("❌ news/data/top-news.json is missing required overview or stories fields");
        process.exit(1);
      }
    ' || exit 1
  fi

  log "Resetting 24h archive window..."
  npm run news:reset

  log "Cleaning up temporary news-digest.md..."
  rm -f news/data/news-digest.md

  log "Staging files..."
  git add news/data/top-news.json news/data/news-24h.json news/data/news.json

  if git diff --staged --quiet; then
    log "ℹ️ No changes detected to commit."
  else
    log "Committing changes..."
    git commit -m "chore(news): update daily news summary [skip ci]"
    log "Pushing to GitHub..."
    git push origin main
    log "✅ Successfully pushed daily news summary to GitHub."
  fi

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
