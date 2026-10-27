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
  0 */3 * * * /home/neuromancer/Personal/techno-tavern/scripts/cron-fetch-news.sh >> /home/neuromancer/logs/techno-tavern-fetch.log 2>&1
  ```
- **What it does:**
  1. Pulls latest `origin/main` (`git pull --rebase`).
  2. Executes `node news/fetch-news.js`, which reads the feed list from `news/sources.json` and fetches all feeds in parallel (one request at a time per host). Each source tries its direct publisher feed first and falls back to its Google News search only if that fails. Reuters has no official feed, so it uses Google News directly.
  3. Updates `news/data/news.json` (active site feed) and `news/data/news-24h.json` (24-hour rolling archive). Titles are stored as clean text, tracking parameters are stripped from links, and duplicate stories across sources are dropped. Also writes `news/data/feed-health.json` (not committed) with each source's status: `ok`, `fallback` (used Google News), `stale` (failed, last good items kept) or `failed`.
  4. Runs `scripts/build-pages.js` (homepage, `/obzor/`, blog pre-render, `feed.xml`, sitemaps).
  5. Commits and pushes changes with `[skip ci]`, then pings IndexNow (`scripts/indexnow.js`).
- **Adding or changing a source:** edit `news/sources.json` only (`name`, `url`, optional `fallback`, `color`, `lang`, `limit`). No code change needed.
- **Health check for Hermes:** after a run, read `news/data/feed-health.json`. If a source has been `stale` or `failed` for several runs in a row, report it with its `errors` field.

---

## 2. Daily Top News Digest & AI Summary (Daily at 18:30)

- **Schedule:** `30 18 * * *` (18:30 Sofia time)
- **Runner:** Hermes agent
- **Script:** [`scripts/daily-top-news.sh`](./scripts/daily-top-news.sh)
- **Rules for the AI:** [`prompts/daily-news-summary.md`](./prompts/daily-news-summary.md)
- **AI input → output:** `news/data/news-digest.md` → `news/data/top-news.json`
- **Discord text:** `news/data/discord-message.txt` (written by the script)

### Hermes Agent Task Configuration

Schedule the Hermes agent at `30 18 * * *` with this prompt:

```markdown
In ~/Personal/techno-tavern:
1. Run: ./scripts/daily-top-news.sh prepare
2. Follow prompts/daily-news-summary.md. Write news/data/top-news.json.
3. Run: ./scripts/daily-top-news.sh finish
4. If step 3 printed "Pipeline complete": post the exact contents of news/data/discord-message.txt to Discord #news (1546793311115681882). Change nothing.
5. If a step failed: post nothing.
```

The agent only writes category, headline, summary and ids. The scripts do everything else.

### What `daily-top-news.sh` handles:
- **`prepare`**: pulls the repo, fetches fresh RSS to close the 24h window, writes `news/data/news-digest.md` (`id|source|title`, no links, to keep the AI input small) and `news-digest-map.json` (id → link, not committed).
- **`finish`**:
  1. `clean`: repairs the AI output (strips code fences or text around the JSON, fixes unknown categories to `Други`, keeps max 5 stories) and fails only if nothing usable is left.
  2. `links`: picks each story's link and sources from its ids by title match.
  3. `archive`: saves `news/data/digests/<date>.json` (becomes `/obzor/<date>/`).
  4. `reset`: clears the 24h window.
  5. `discord`: writes `news/data/discord-message.txt`.
  6. Builds the pages and renders the social cards (`scripts/social-cards.js`, non-fatal).
  7. Commits `[skip ci]`, pushes, and pings IndexNow.
  8. Posts to Facebook + Instagram (`scripts/social-post.js --auto`, non-fatal, only with `AUTO_POST=1`).

---

## 3. Social Media Posts (part of `finish`)

- **Requires** `npm install` (Playwright + its own Chromium inside `node_modules`, nothing system-wide). `prepare` runs it automatically when `node_modules/playwright` is missing. If the browser fails to launch on a minimal Pi OS, install its system libraries once: `sudo npx playwright install-deps chromium`.
- **Cards:** `node scripts/social-cards.js [date]` → `news/data/social/<date>/`: `01-cover.jpg` (all headlines), one `NN-story.jpg` per story, `facebook.txt`, `instagram.txt`. Design: `scripts/social-card.html`.
- **Posting:** `node scripts/social-post.js [date] [--dry-run] [--only=facebook|instagram]`. Facebook gets the cover + full text (`FACEBOOK_IMAGES=all` for every card); Instagram gets a carousel of all cards. Already-posted platforms are recorded in `news/data/social/<date>.posted.json` and never posted twice.
- **Credentials** in `.env` at the repo root (gitignored, `chmod 600`): `cp .env.example .env` and fill in `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID`. Add `AUTO_POST=1` to let `finish` post; leave it out while testing by hand.
