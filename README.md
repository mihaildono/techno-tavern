# Techno Tavern Plovdiv

Independent Bulgarian news stream from Plovdiv.

Visit [technotavern.com](https://technotavern.com)

## Local Development

To view the site locally with full functionality:

### Start server locally
```sh
npm run start
```

### Fetch latest news
```sh
npm run fetch-news
```

### Note about file:// protocol
Opening `index.html` directly in your browser (file:// protocol) will fail to load the news feed due to CORS restrictions. Use the local server above to see the actual news.json data.

## Pages

- **News** (`/`): Evening digest of the day's top stories plus a timeline of the latest headlines from 10 sources (auto-updated every 3 hours). `/news/` redirects here; feed data still lives in `news/data/`.
- **Blog** (`/blog/`): Mastodon feed from @Technotavern@masto.bg
- **How it works** (`/about/`)
- **Archive**: Politics (`/politics/`) and Stocks (`/stocks/`). The stock screener is frozen: its GitHub Actions workflows were removed and the data in `stocks/data/` is the last scan (2026-10-20). The script and its `requirements.txt` stay in `stocks/` for reference.

## Automated Jobs & Schedules

Background cron jobs and Hermes agent tasks are documented in detail in [CRONS.md](./CRONS.md).
