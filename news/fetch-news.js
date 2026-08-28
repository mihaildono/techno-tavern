#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");

// Active feed shown on the site (overwritten on every run)
const OUTPUT_FILE = path.join(__dirname, "data", "news.json");
// Rolling accumulator of everything seen in the last 24h (never overwritten,
// only appended to + pruned). Cleared by reset-news-24h.js after the daily
// top-news summary is generated.
const ARCHIVE_FILE = path.join(__dirname, "data", "news-24h.json");
const ARCHIVE_WINDOW_HOURS = 24;

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
    url: "https://news.google.com/rss/search?q=site:dnevnik.bg&hl=bg&gl=BG&ceid=BG:bg",
    color: "#2196F3", // Blue
    type: "direct",
  },
  {
    name: "Свободна точка",
    url: "https://news.google.com/rss/search?q=site:svobodnatochka.bg&hl=bg&gl=BG&ceid=BG:bg",
    color: "#FF9800", // Orange
    type: "direct",
  },
  {
    name: "Mediapool",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.mediapool.bg%2Frss%2F",
    color: "#00BCD4", // Teal
    type: "rss2json",
  },
  {
    name: "Capital",
    url: "https://news.google.com/rss/search?q=site:capital.bg&hl=bg&gl=BG&ceid=BG:bg",
    color: "#4CAF50", // Green
    type: "direct",
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
  {
    name: "FrogNews",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Frss.frognews.bg%2F",
    color: "#00897B", // Teal-green
    type: "rss2json",
  },
  {
    name: "DW",
    url: "https://rss.dw.com/rdf/rss-en-top",
    color: "#C8102E", // DW Red
    type: "direct",
  },
];

// --- Helpers ---

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RSS-Reader/1.0; +https://technotavern.com)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    };
    const req = https
      .get(options, (res) => {
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

function parseRssXml(xml) {
  const items = [];
  const itemRegex = /<item(?:\s[^>]*)?>([^]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const getText = (tag) => {
      const m =
        new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`).exec(
          block,
        ) || new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`).exec(block);
      return m ? m[1].trim() : "";
    };
    const title = getText("title");
    const link =
      (/<link>\s*([^<]+)\s*<\/link>/.exec(block) || [])[1]?.trim() ||
      (/<link[^>]+href="([^"]+)"/.exec(block) || [])[1] ||
      "";
    const pubDate = getText("pubDate") || getText("dc:date");
    const mediaMatch =
      /media:content[^>]+url="([^"]+)"/.exec(block) ||
      /media:thumbnail[^>]+url="([^"]+)"/.exec(block) ||
      /enclosure[^>]+url="([^"]+)"/.exec(block);
    const thumbnail = mediaMatch ? { link: mediaMatch[1] } : null;
    if (title && link) items.push({ title, link, pubDate, thumbnail });
  }
  return items;
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

// Returns: array of items on success, null on permanent failure, [] on transient failure
async function fetchFeed(source) {
  try {
    const { status, data } = await fetchUrl(source.url);

    if (status < 200 || status >= 300) {
      console.error(`  ❌ HTTP ${status} from ${source.name}`);
      // For rss2json, a non-2xx with {"status":"error"} means the upstream feed
      // is blocked or invalid — retrying will never help.
      if (source.type === "rss2json") {
        try {
          const json = JSON.parse(data);
          if (json.status === "error") return null; // permanent
        } catch (_) {}
      }
      return [];
    }

    if (source.type === "direct") {
      const items = parseRssXml(data);
      return items.slice(0, 5).map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        thumbnail: item.thumbnail,
        source: { name: source.name, color: source.color },
      }));
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

    // null = permanent failure (e.g. upstream blocked), no point retrying
    if (items === null) {
      console.log(`⚠️  Skipping retries for ${source.name} (upstream blocked)`);
      return [];
    }

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

// --- 24h rolling archive ---

function dedupeKey(item) {
  if (item.link) {
    try {
      const url = new URL(item.link);
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
    } catch (_) {
      return item.link.trim();
    }
  }
  return `${item.source?.name || ""}::${(item.title || "").trim().toLowerCase()}`;
}

function loadArchive() {
  try {
    if (fs.existsSync(ARCHIVE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
      if (Array.isArray(data.items)) return data;
    }
  } catch (e) {
    console.log("⚠️  Could not read existing news-24h.json, starting fresh");
  }
  return { windowStart: null, lastUpdated: null, items: [] };
}

function updateArchive(freshItems) {
  const now = new Date();
  const archive = loadArchive();
  const cutoff = now.getTime() - ARCHIVE_WINDOW_HOURS * 60 * 60 * 1000;

  const seen = new Map();
  for (const item of archive.items) {
    seen.set(dedupeKey(item), item);
  }

  let added = 0;
  for (const item of freshItems) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.set(key, { ...item, firstSeen: now.toISOString() });
    added++;
  }

  const kept = [...seen.values()].filter((item) => {
    const ts = Date.parse(item.firstSeen || item.pubDate || "");
    return Number.isNaN(ts) ? true : ts >= cutoff;
  });

  const dropped = seen.size - kept.length;

  kept.sort((a, b) => {
    const at = Date.parse(a.firstSeen || a.pubDate || 0) || 0;
    const bt = Date.parse(b.firstSeen || b.pubDate || 0) || 0;
    return bt - at;
  });

  const output = {
    windowStart: archive.windowStart || now.toISOString(),
    windowHours: ARCHIVE_WINDOW_HOURS,
    lastUpdated: now.toISOString(),
    totalItems: kept.length,
    items: kept,
  };

  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(output, null, 2));

  console.log(
    `🗄️  news-24h.json: +${added} new, -${dropped} expired, ${kept.length} total (window started ${output.windowStart})`,
  );
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
  updateArchive(allItems);

  console.log("\n✅ Successfully updated news.json");
  console.log(`📰 Total articles: ${output.items.length}`);
  console.log(`🕐 Last updated: ${output.lastUpdated}`);

  const withThumbnails = output.items.filter((item) => item.thumbnail).length;
  console.log(
    `🖼️  Articles with images: ${withThumbnails}/${output.items.length}`,
  );
}

fetchAllFeeds();
