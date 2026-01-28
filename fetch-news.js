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
    name: "Hacker News",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.ycombinator.com%2Frss",
    color: "#FF6600", // HN Orange
    type: "rss2json",
  },
];

function fetchFeed(source) {
  return new Promise((resolve, reject) => {
    https
      .get(source.url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const feedData = JSON.parse(data);

            if (!feedData.items || feedData.items.length === 0) {
              console.log(`⚠️  No items found in ${source.name}`);
              resolve([]);
              return;
            }

            const items = feedData.items.slice(0, 5).map((item) => {
              // Normalize thumbnail to always be an object with link property
              const thumbnail = item.thumbnail || item.enclosure || null;
              const normalizedThumbnail = thumbnail
                ? typeof thumbnail === "string"
                  ? { link: thumbnail }
                  : thumbnail
                : null;

              return {
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
                thumbnail: normalizedThumbnail,
                source: {
                  name: source.name,
                  color: source.color,
                },
              };
            });

            console.log(
              `✅ Fetched ${items.length} articles from ${source.name}`,
            );
            resolve(items);
          } catch (error) {
            console.error(`❌ Error parsing ${source.name}:`, error.message);
            resolve([]);
          }
        });
      })
      .on("error", (error) => {
        console.error(`❌ Error fetching ${source.name}:`, error.message);
        resolve([]);
      });
  });
}

async function fetchAllFeeds() {
  console.log("📡 Fetching RSS feeds from multiple sources...\n");

  const allItems = [];

  // Fetch feeds sequentially to maintain order
  for (const source of RSS_SOURCES) {
    const items = await fetchFeed(source);
    allItems.push(...items);
  }

  if (allItems.length === 0) {
    console.error("❌ No items fetched from any source");
    process.exit(1);
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
