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
- **News**: Latest 5 articles from various news sites (auto-updated every 6 hours via GitHub Actions)
