#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/neuromancer/Personal/techno-tavern"
GIT_USER_NAME="Neuromancer"
GIT_USER_EMAIL="neuromancer@hermes.ai"
NODE_PATH="/home/neuromancer/.local/bin/node"

# Ensure node is in PATH for cron environment
export PATH="$HOME/.local/bin:$PATH"

# Change to repository directory
cd "$REPO_DIR"

# Set git config (ensure these are set)
git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

# Pull latest changes from GitHub (use autostash to handle local changes)
echo "🔄 Pulling latest changes from origin/main..."
if ! git pull --rebase --autostash origin main; then
    echo "⚠️  Git pull had issues — attempting to continue with local state"
    # Reset any partial rebase state
    git rebase --abort 2>/dev/null || true
    # Drop any autostash entries from failed pulls
    git stash list 2>/dev/null | grep -q '^#' && git stash drop 2>/dev/null || true
fi

# Execute Node.js script to fetch news
echo "📰 Fetching news from RSS feeds..."
"$NODE_PATH" news/fetch-news.js

# Check if there are any changes to commit
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "📝 Committing and pushing changes..."

    # Stage changes
    git add news/data/news.json news/data/news-24h.json

    # Commit with skip ci
    git commit -m "$(date '+%Y-%m-%d %H:%M:%S') - Update news feeds [skip ci]"

    # Push to remote
    git push origin main

    echo "✅ Successfully updated and pushed news feeds"
else
    echo "ℹ️  No changes detected - news feeds are up to date"
fi

echo "🎉 News fetch pipeline completed successfully"
