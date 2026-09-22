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
    color: "#E91E63",
    type: "rss2json",
  },
  {
    name: "Dnevnik",
    url: "https://news.google.com/rss/search?q=site:dnevnik.bg&hl=bg&gl=BG&ceid=BG:bg",
    color: "#2196F3",
    type: "direct",
  },
  {
    name: "Свободна точка",
    url: "https://svobodnatochka.bg/feed/",
    color: "#FF9800",
    type: "direct",
  },
  {
    name: "Mediapool",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.mediapool.bg%2Frss%2F",
    color: "#00BCD4",
    type: "rss2json",
  },
  {
    name: "Actualno",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.actualno.com%2Frss",
    color: "#9C27B0",
    type: "rss2json",
  },
  {
    name: "Hacker News",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.ycombinator.com%2Frss",
    color: "#FF6600",
    type: "rss2json",
  },
  {
    name: "FrogNews",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Frss.frognews.bg%2F",
    color: "#00897B",
    type: "rss2json",
  },
  {
    name: "Reuters",
    url: "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en",
    color: "#4169E1",
    type: "direct",
  },
  {
    name: "DW",
    url: "https://rss.dw.com/rdf/rss-en-top",
    color: "#C8102E",
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
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,text/xml,*/*;q=0.8",
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
  const itemRegex = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const getText = (tag) => {
      // Check for CDATA-wrapped content
      const cdataStart = `<${tag}><![CDATA[`;
      const cdataEnd = "]]></" + tag + ">";
      let start = block.indexOf(cdataStart);
      if (start !== -1) {
        start += cdataStart.length;
        const end = block.indexOf(cdataEnd, start);
        if (end !== -1) {
          return block.substring(start, end).trim();
        }
      }
      // Fall back to plain text regex
      const plain = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">");
      const m = plain.exec(block);
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
      /enclosure[^>]+url="([^"]+)"/.exec(block) ||
      /<img[^>]+src=["']([^"']+)["']/i.exec(block);
    const thumbnail = mediaMatch ? { link: mediaMatch[1] } : null;
    if (title && link) items.push({ title, link, pubDate, thumbnail });
  }
  return items;
}

// --- Normalize pubDate to canonical UTC with Z suffix ---
function normalizePubDate(pubDate) {
  if (!pubDate) return null;
  const raw = String(pubDate).trim();
  if (!raw) return null;

  // Normalize every recognized input format to canonical UTC ISO 8601.
  // This includes GMT, Z, explicit offsets, and timezone-less feed values.
  const timestamp = parseArticleDate(raw);
  return timestamp === null ? raw : new Date(timestamp).toISOString();
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
    pubDate: normalizePubDate(item.pubDate),
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

    if (status < 200 || status >= 300) {
      console.error("  ❌ HTTP " + status + " from " + source.name);
      if (source.type === "rss2json") {
        try {
          const json = JSON.parse(data);
          if (json.status === "error") return null;
        } catch (_) {}
      }
      return [];
    }

    if (source.type === "direct") {
      const items = parseRssXml(data);
      return items.slice(0, 5).map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: normalizePubDate(item.pubDate),
        thumbnail: item.thumbnail,
        source: { name: source.name, color: source.color },
      }));
    }

    const feedData = JSON.parse(data);
    return parseFeedItems(source, feedData);
  } catch (error) {
    console.error("  ❌ Error fetching " + source.name + ": " + error.message);
    return [];
  }
}

async function fetchFeedWithRetry(source, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const items = await fetchFeed(source);
    if (items === null) {
      console.log("⚠️  Skipping retries for " + source.name + " (upstream blocked)");
      return [];
    }
    if (items.length > 0) {
      console.log("✅ Fetched " + items.length + " articles from " + source.name);
      return items;
    }
    if (attempt < maxRetries) {
      const waitMs = 2000 * attempt;
      console.log(
        "  🔄 Retrying " + source.name + " (attempt " + (attempt + 1) + "/" + maxRetries + ") in " + (waitMs / 1000) + "s...",
      );
      await delay(waitMs);
    }
  }
  console.log(
    "⚠️  Failed to fetch " + source.name + " after " + maxRetries + " attempts",
  );
  return [];
}

// --- Preserve old news on failure ---

const MAX_ARTICLE_AGE_HOURS = 10;
const SOURCE_TIMEZONE = "Europe/Sofia";

function parseArticleDate(pubDate) {
  if (!pubDate) return null;

  const raw = String(pubDate).trim();
  if (!raw) return null;

  // RFC 2822 with GMT
  if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) {
    return Date.parse(raw);
  }

  // ISO 8601 with Z (optional milliseconds)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(raw)) {
    return Date.parse(raw);
  }

  // ISO 8601 without timezone: treat as UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return Date.parse(raw + "Z");
  }

  // ISO 8601 with explicit offset
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/.test(raw)) {
    const normalized = raw.slice(0, -5) + ":" + raw.slice(-5);
    const t = Date.parse(normalized);
    if (Number.isFinite(t)) return t;
    return Date.parse(raw);
  }

  // YYYY-MM-DD HH:MM:SS
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    if (utcTimestamp <= Date.now()) {
      return utcTimestamp;
    }
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: SOURCE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcTimestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const shiftedTimestamp = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return utcTimestamp - (shiftedTimestamp - utcTimestamp);
  }

  return null;
}

function isWithinAgeLimit(pubDate) {
  const timestamp = parseArticleDate(pubDate);
  if (timestamp === null) return true;
  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  return ageHours <= MAX_ARTICLE_AGE_HOURS;
}

function loadExistingNews() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      const items = data.items || [];
      const fresh = items.filter((item) => isWithinAgeLimit(item.pubDate));
      if (fresh.length < items.length) {
        console.log(
          "⏰ Filtered " + (items.length - fresh.length) + " stale article(s) from existing news.json (older than " + MAX_ARTICLE_AGE_HOURS + "h)",
        );
      }
      return fresh;
    }
  } catch (e) {
    console.log("⚠️  Could not read existing news.json");
  }
  return [];
}

function dedupeKey(item) {
  if (item.link) {
    try {
      const url = new URL(item.link);
      return url.hostname.toLowerCase() + url.pathname.replace(/\/+$/, "");
    } catch (_) {
      return item.link.trim();
    }
  }
  return (item.source?.name || "") + "::" + (item.title || "").trim().toLowerCase();
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
    seen.set(key, Object.assign({}, item, { firstSeen: now.toISOString() }));
    added++;
  }

  const kept = [...seen.values()].filter((item) => {
    const firstSeenTs = Date.parse(item.firstSeen || "");
    if (!Number.isNaN(firstSeenTs) && firstSeenTs < cutoff) return false;
    const pubTs = parseArticleDate(item.pubDate);
    if (pubTs !== null) {
      const pubAgeHours = (now.getTime() - pubTs) / (1000 * 60 * 60);
      if (pubAgeHours > ARCHIVE_WINDOW_HOURS) return false;
    }
    return true;
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
    "🗄️  news-24h.json: +" + added + " new, -" + dropped + " expired, " + kept.length + " total",
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
      const fresh = items.filter((item) => isWithinAgeLimit(item.pubDate));
      if (fresh.length > 0) {
        allItems.push(...fresh);
        if (fresh.length < items.length) {
          console.log(
            "⏰ Filtered " + (items.length - fresh.length) + " stale article(s) from " + source.name + " (older than " + MAX_ARTICLE_AGE_HOURS + "h)",
          );
        }
      }
    } else {
      failedSources.push(source.name);
      const oldItems = existingItems.filter(
        (item) => item.source?.name === source.name,
      );
      if (oldItems.length > 0) {
        console.log(
          "📦 Keeping " + oldItems.length + " existing articles from " + source.name,
        );
        allItems.push(...oldItems);
      }
    }
    await delay(1500);
  }

  if (allItems.length === 0) {
    console.error("❌ No items fetched from any source");
    process.exit(1);
  }

  const beforeCount = allItems.length;
  const filteredItems = allItems.filter((item) => isWithinAgeLimit(item.pubDate));
  const staleDropped = beforeCount - filteredItems.length;

  if (filteredItems.length === 0) {
    console.error("❌ No items fetched from any source");
    process.exit(1);
  }

  filteredItems.sort((a, b) => {
    const dateA = parseArticleDate(a.pubDate) || 0;
    const dateB = parseArticleDate(b.pubDate) || 0;
    return dateB - dateA;
  });

  let sortViolations = 0;
  for (let i = 0; i < filteredItems.length - 1; i++) {
    const a = parseArticleDate(filteredItems[i].pubDate) || 0;
    const b = parseArticleDate(filteredItems[i + 1].pubDate) || 0;
    if (a < b) sortViolations++;
  }
  if (sortViolations > 0) {
    console.error("❌ Sort verification failed: " + sortViolations + " violations found");
    process.exit(1);
  }
  console.log("✅ Sort verified: " + filteredItems.length + " articles in time order");

  if (failedSources.length > 0) {
    console.log(
      "\n⚠️  Sources that failed (old data preserved): " + failedSources.join(", "),
    );
    if (staleDropped > 0) {
      console.log(
        "⏰ Removed " + staleDropped + " stale article(s) (older than " + MAX_ARTICLE_AGE_HOURS + "h) from active feed",
      );
    }
  }

  const output = {
    items: filteredItems,
    lastUpdated: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  updateArchive(filteredItems);

  console.log("\n✅ Successfully updated news.json");
  console.log("📰 Total articles: " + output.items.length);
  console.log("🕐 Last updated: " + output.lastUpdated);

  const withThumbnails = output.items.filter((item) => item.thumbnail).length;
  console.log(
    "🖼️  Articles with images: " + withThumbnails + "/" + output.items.length,
  );
}

fetchAllFeeds();