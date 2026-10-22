# AGENTS.md

Techno Tavern (technotavern.com): a Bulgarian news aggregator. Static site on GitHub Pages, no framework, no build step besides plain Node scripts. UI text is Bulgarian.

## Layout

| Path | What |
|---|---|
| `index.html` | Homepage: evening digest + headline stream. Blocks between `<!--DIGEST:…-->`, `<!--FEED:…-->`, `<!--JSONLD:…-->` are generated. Never edit them by hand. |
| `obzor/` | Generated. `/obzor/` = archive list, `/obzor/YYYY-MM-DD/` = one page per daily digest. |
| `blog/` | Mastodon posts; `<!--POSTS:…-->` block is generated. |
| `about/`, `politics/`, `stocks/` | Hand-written pages. Politics = editorial opinion; stocks = frozen archive. |
| `news/sources.json` | Feed list. Add a source here; no code change needed. |
| `news/fetch-news.js` | Fetches feeds → `news/data/news.json` (live stream) + `news-24h.json` (24h window). |
| `news/news-daily.js` | Evening digest helper: `digest`, `clean`, `links`, `archive`, `reset`, `discord`. |
| `news/data/top-news.json` | Today's digest (shown on homepage). |
| `news/data/digests/YYYY-MM-DD.json` | Digest history. One file per day; source of `/obzor/` pages. |
| `prompts/daily-news-summary.md` | The only instructions the summarising agent needs. |
| `scripts/build-pages.js` + `site-pages.js` | Render all generated HTML, `feed.xml`, `sitemap.xml`, `news-sitemap.xml`, `robots.txt`. |
| `scripts/cron-fetch-news.sh` | Every 3h: fetch → build → commit → push → IndexNow. |
| `scripts/daily-top-news.sh` | Evening digest: `prepare` / `finish`. |
| `CRONS.md` | Schedules and the Hermes task prompt. |

## Jobs (Raspberry Pi, Europe/Sofia)

1. **Every 3h** `scripts/cron-fetch-news.sh`. No AI.
2. **18:30** Hermes agent:
   1. `./scripts/daily-top-news.sh prepare` → writes `news/data/news-digest.md` (`id|source|title`).
   2. Agent follows `prompts/daily-news-summary.md` → writes `news/data/top-news.json` (overview + stories with category, headline, summary, ids).
   3. `./scripts/daily-top-news.sh finish` → clean, links, archive (creates the history file), reset, discord, build, commit, push.
   4. Agent posts `news/data/discord-message.txt` to Discord #news verbatim, only if `finish` printed `Pipeline complete`.

## Daily history (obzor)

- Created automatically by `finish`: `news-daily.js archive` saves `news/data/digests/<Sofia date>.json`, then `build-pages.js` renders `obzor/<date>/index.html`, updates `/obzor/`, `feed.xml` and both sitemaps. Both paths are committed.
- Running `finish` twice on one day overwrites that day's file. That is fine.
- Missed evening: run the evening steps again by hand (prepare → write `top-news.json` → finish).
- Lost history files: `npm run backfill-digests` rebuilds them from git history of `top-news.json` (keeps existing files; `--force` overwrites).
- Never delete a published `obzor/<date>/` page: it is indexed by search engines.

## Rules for agents

- Keep the summarising agent's work minimal. Anything a script can do (links, sources, dates, validation, Discord formatting) belongs in `news-daily.js`, not in the prompt. Keep `prompts/daily-news-summary.md` short.
- After changing data or templates, run `node scripts/build-pages.js`.
- Automated commits end with `[skip ci]`.
- Do not hand-edit generated files (see Layout). Change the generator instead.
- Plain Node (≥18) and Bash only; no new dependencies.
- The file `8cce13b196e3062594dcdb8a59b40430.txt` is the IndexNow key. It must stay at the site root.
- Not committed: `news/data/news-digest.md`, `news-digest-map.json`, `discord-message.txt`, `feed-health.json`.

## Local

`npm start` → http://localhost:8000 · `npm run fetch-news` · `npm run build`
