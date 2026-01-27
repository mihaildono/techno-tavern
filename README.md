# Techno Tavern Plovdiv

Co-working and event space in Plovdiv

Visit [technotavern.com](https://technotavern.com)

## Local Development

To view the site locally with full functionality:

### Option 1: Using the serve script (Recommended)
```bash
./serve.sh
```
Then open http://localhost:8080 in your browser.

### Option 2: Using Python directly
```bash
python3 -m http.server 8080
```
Then open http://localhost:8080 in your browser.

### Note about file:// protocol
Opening `index.html` directly in your browser (file:// protocol) will show sample data for the news feed due to CORS restrictions. Use one of the local server options above to see the actual news.json data.

## Features

- **Home**: Mastodon feed from @Technotavern@masto.bg
- **News**: Latest 5 articles from offnews.bg (auto-updated every 30 minutes via GitHub Actions)
