#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "news.json");

// RSS feeds with source metadata
const RSS_SOURCES = [
  {
    name: "OffNews",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Foffnews.bg%2Frss%2Fall",
    color: "#E91E63", // Pink
    type: "rss2json",
  },
  {
    name: "Dnevnik",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.dnevnik.bg%2Frss",
    color: "#2196F3", // Blue
    type: "rss2json",
  },
  {
    name: "Svobodna Evropa",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.svobodnaevropa.bg%2Fapi%2Fzgmpmil-vomx-tpe--_mm",
    color: "#FF9800", // Orange
    type: "rss2json",
  },
  {
    name: "Capital",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.capital.bg%2Frss",
    color: "#4CAF50", // Green
    type: "rss2json",
  },
  {
    name: "Actualno",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.actualno.com%2Frss",
    color: "#9C27B0", // Purple
    type: "rss2json",
  },
  {
    name: "Hacker News",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.ycombinator.com%2Frss",
    color: "#FF6600", // HN Orange
    type: "rss2json",
  },
];

// --- Helpers ---

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, data });
        });
      })
      .on("error", (error) => {
        reject(error);
      });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

function normalizeThumbnail(item) {
  const raw = item.thumbnail || item.enclosure || null;
  if (!raw) return null;
  if (typeof raw === "string") {
    return raw.trim() ? { link: raw.trim() } : null;
  }
  return raw.link ? raw : null;
}

function parseFeedItems(source, feedData) {
  if (!feedData.items || feedData.items.length === 0) {
    return [];
  }

  return feedData.items.slice(0, 5).map((item) => ({
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    thumbnail: normalizeThumbnail(item),
    source: {
      name: source.name,
      color: source.color,
    },
  }));
}

// --- Fetch with retry ---

async function fetchFeed(source) {
  try {
    const { status, data } = await fetchUrl(source.url);

    if (status !== 200) {
      console.error(`  ❌ HTTP ${status} from ${source.name}`);
      return [];
    }

    const feedData = JSON.parse(data);
    return parseFeedItems(source, feedData);
  } catch (error) {
    console.error(`  ❌ Error fetching ${source.name}: ${error.message}`);
    return [];
  }
}

async function fetchFeedWithRetry(source, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const items = await fetchFeed(source);

    if (items.length > 0) {
      console.log(`✅ Fetched ${items.length} articles from ${source.name}`);
      return items;
    }

    if (attempt < maxRetries) {
      const waitMs = 2000 * attempt;
      console.log(
        `  🔄 Retrying ${source.name} (attempt ${attempt + 1}/${maxRetries}) in ${waitMs / 1000}s...`,
      );
      await delay(waitMs);
    }
  }

  console.log(
    `⚠️  Failed to fetch ${source.name} after ${maxRetries} attempts`,
  );
  return [];
}

// --- Preserve old news on failure ---

function loadExistingNews() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      return data.items || [];
    }
  } catch (e) {
    console.log("⚠️  Could not read existing news.json");
  }
  return [];
}

// --- Main ---

async function fetchAllFeeds() {
  console.log("📡 Fetching RSS feeds from multiple sources...\n");

  const existingItems = loadExistingNews();
  const allItems = [];
  const failedSources = [];

  for (const source of RSS_SOURCES) {
    const items = await fetchFeedWithRetry(source);

    if (items.length > 0) {
      allItems.push(...items);
    } else {
      failedSources.push(source.name);
      // Preserve old articles from this source
      const oldItems = existingItems.filter(
        (item) => item.source?.name === source.name,
      );
      if (oldItems.length > 0) {
        console.log(
          `📦 Keeping ${oldItems.length} existing articles from ${source.name}`,
        );
        allItems.push(...oldItems);
      }
    }

    // Delay between sources to avoid rss2json rate limiting
    await delay(1500);
  }

  if (allItems.length === 0) {
    console.error("❌ No items fetched from any source");
    process.exit(1);
  }

  if (failedSources.length > 0) {
    console.log(
      `\n⚠️  Sources that failed (old data preserved): ${failedSources.join(", ")}`,
    );
  }

  const output = {
    items: allItems,
    lastUpdated: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n✅ Successfully updated news.json");
  console.log(`📰 Total articles: ${output.items.length}`);
  console.log(`🕐 Last updated: ${output.lastUpdated}`);

  const withThumbnails = output.items.filter((item) => item.thumbnail).length;
  console.log(
    `🖼️  Articles with images: ${withThumbnails}/${output.items.length}`,
  );
}

fetchAllFeeds();
