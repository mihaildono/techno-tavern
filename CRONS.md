# Automated Crons & Agent Schedules

This document details all scheduled background jobs and automated agent pipelines for Techno Tavern, running locally on the Raspberry Pi and Hermes agent.

---

## System Requirements

- **Timezone:** Ensure the host machine (Raspberry Pi) runs in Bulgarian local time:
  ```bash
  sudo timedatectl set-timezone Europe/Sofia
  ```
- **Log Directory:**
  ```bash
  mkdir -p ~/logs
  ```

---

## 1. News Feed Fetcher (Every 3 Hours)

- **Schedule:** `0 */3 * * *` (Runs at `00:00`, `03:00`, `06:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00` Sofia Time)
- **Runner:** System Crontab (`crontab -e`)
- **Script:** [`scripts/cron-fetch-news.sh`](./scripts/cron-fetch-news.sh)
- **Crontab Entry:**
  ```cron
  # Fetch news every 3 hours (aligned with 18:00 Sofia time)
  0 */3 * * * /home/pi/Personal/techno-tavern/scripts/cron-fetch-news.sh >> /home/pi/logs/techno-tavern-fetch.log 2>&1
  ```
- **What it does:**
  1. Pulls latest `origin/main` (`git pull --rebase`).
  2. Executes `node news/fetch-news.js` to query 9 RSS feeds (direct and Google News endpoints).
  3. Updates `news/data/news.json` (active site feed) and `news/data/news-24h.json` (24-hour rolling archive).
  4. Commits and pushes changes with `[skip ci]`.

---

## 2. Daily Top News Digest & AI Summary (Daily at 18:30)

- **Schedule:** `30 18 * * *` (18:30 / 6:30 PM Sofia Time)
- **Runner:** Hermes Agent
- **Scripts & Rules:**
  - Script: [`scripts/daily-top-news.sh`](./scripts/daily-top-news.sh)
  - Prompt Rules: [`prompts/daily-news-summary.md`](./prompts/daily-news-summary.md)
  - Digest Input: `news/data/news-digest.md`
  - Output Target: `news/data/top-news.json`

### Hermes Agent Task Configuration

Schedule the Hermes agent at `30 18 * * *` with the following prompt:

```markdown
Run the daily news summarization pipeline for Techno Tavern:

1. In the repository directory (~/Personal/techno-tavern), run:
   ./scripts/daily-top-news.sh prepare

2. Read `news/data/news-digest.md` and the prompt instructions in `prompts/daily-news-summary.md`.

3. Group related stories, pick the top 3-5 key events, categorize them strictly into the predefined categories, and write the structured summary into `news/data/top-news.json`.

4. Run:
   ./scripts/daily-top-news.sh finish
```

### What `daily-top-news.sh` handles:
- **`prepare`**: Pulls repo, fetches fresh RSS to close the 24h window, and compiles `news/data/news-digest.md`.
- **`finish`**: Validates the schema of `news/data/top-news.json`, clears the 24h archive window (`npm run news:reset`), removes temporary digest files, commits `[skip ci]`, and pushes to GitHub.
