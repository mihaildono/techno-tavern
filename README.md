# Techno Tavern Plovdiv

Social space in Plovdiv

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
Opening `index.html` directly in your browser (file:// protocol) will show sample data for the news feed due to CORS restrictions. Use one of the local server options above to see the actual news.json data.

## Features

- **Home**: Mastodon feed from @Technotavern@masto.bg
- **News**: Latest articles from 9 curated news sources (auto-updated every 3 hours)
- **Daily Top News**: AI-curated daily overview and top stories summary published at 18:30 Sofia time

## Automated Jobs & Schedules

Background cron jobs and Hermes agent tasks are documented in detail in [CRONS.md](./CRONS.md).
