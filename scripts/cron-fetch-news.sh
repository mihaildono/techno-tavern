#!/bin/bash

set -euo pipefail

REPO_DIR="/home/neuromancer/Personal/techno-tavern"
GIT_USER_NAME="Neuromancer"
GIT_USER_EMAIL="neuromancer@hermes.ai"

# Change to repository directory
cd "$REPO_DIR"

# Set git config (ensure these are set)
git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

# Pull latest changes from GitHub
echo "🔄 Pulling latest changes from origin/main..."
git pull --rebase origin main

# Execute Node.js script to fetch news
echo "📰 Fetching news from RSS feeds..."
node news/fetch-news.js

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