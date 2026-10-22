#!/usr/bin/env node
// Fetches the RSS/Atom feeds listed in news/sources.json and writes:
//   news/data/news.json       active site feed (overwritten every run)
//   news/data/news-24h.json   rolling 24h archive used by the evening digest
//   news/data/feed-health.json  per-source status of this run (not committed)
//
// Feeds are fetched in parallel (a few at a time, one at a time per host so
// Google News is not hammered). Each source tries its direct feed first and
// falls back to its Google News search only if the direct feed fails.

const https = require("https");
const http = require("http");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SOURCES_FILE = path.join(__dirname, "sources.json");
const OUTPUT_FILE = path.join(DATA_DIR, "news.json");
const ARCHIVE_FILE = path.join(DATA_DIR, "news-24h.json");
const HEALTH_FILE = path.join(DATA_DIR, "feed-health.json");

const ARCHIVE_WINDOW_HOURS = 24;
const MAX_ARTICLE_AGE_HOURS = 24;
const DEFAULT_LIMIT = 5;
const CONCURRENCY = 4;
const SAME_HOST_GAP_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const RETRIES_PER_URL = 2;
const SOURCE_TIMEZONE = "Europe/Sofia";

const { main: RSS_SOURCES } = JSON.parse(
  fs.readFileSync(SOURCES_FILE, "utf8"),
);

// --- Small utilities ---

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run fn over items with at most `limit` in flight; results keep input order.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Serialize requests per hostname with a small gap between them.
const hostQueues = new Map();
function withHostSlot(url, task) {
  const host = new URL(url).hostname;
  const prev = hostQueues.get(host) || Promise.resolve();
  const run = prev.then(task);
  hostQueues.set(
    host,
    run.catch(() => {}).then(() => delay(SAME_HOST_GAP_MS)),
  );
  return run;
}

// --- HTTP ---

// Pick the charset from the Content-Type header or the XML declaration,
// falling back to UTF-8 (some Bulgarian feeds still ship windows-1251).
function decodeBody(buffer, contentType = "") {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || "");
  const head = buffer.subarray(0, 200).toString("latin1");
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  const charset = (fromHeader?.[1] || fromXml?.[1] || "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch (_) {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function decompress(buffer, encoding) {
  switch ((encoding || "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(buffer);
    case "deflate":
      return zlib.inflateSync(buffer);
    case "br":
      return zlib.brotliDecompressSync(buffer);
    default:
      return buffer;
  }
}

function fetchUrl(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "bg,en;q=0.8",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (depth >= 5) return reject(new Error("Too many redirects"));
          resolve(fetchUrl(new URL(res.headers.location, url).toString(), depth + 1));
          return;
        }
        // Collect raw bytes and decode once at the end: appending chunks as
        // strings splits multi-byte Cyrillic characters across chunk boundaries.
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("Response larger than " + MAX_BODY_BYTES + " bytes"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const raw = decompress(Buffer.concat(chunks), res.headers["content-encoding"]);
            resolve({ status: res.statusCode, data: decodeBody(raw, res.headers["content-type"]) });
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Timed out after " + REQUEST_TIMEOUT_MS + "ms"));
    });
  });
}

// --- Text cleanup ---

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// Titles come back with entities, sometimes double-encoded (&amp;quot;) and
// sometimes with stray tags; store plain text so every consumer (site,
// digest prompt, build-pages) sees the same clean headline.
function cleanText(text) {
  let out = String(text || "");
  for (let i = 0; i < 2 && /&[#a-z0-9]+;/i.test(out); i++) out = decodeEntities(out);
  return out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|cmpid|srnd|ocid|mc_cid|mc_eid)$/i;

function cleanLink(link) {
  const raw = decodeEntities(String(link || "").trim());
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch (_) {
    return raw;
  }
}

// --- Feed parsing (RSS 2.0, RSS 1.0/RDF, Atom) ---

function tagText(block, tag) {
  const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i");
  const m = re.exec(block);
  if (!m) return "";
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return (cdata ? cdata[1] : inner).trim();
}

function findImage(block) {
  const m =
    /<media:content[^>]+url=["']([^"']+)["'][^>]*>/i.exec(block) ||
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i.exec(block) ||
    /<enclosure[^>]+type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i.exec(block) ||
    /<enclosure[^>]+url=["']([^"']+\.(?:jpe?g|png|webp|gif)(?:\?[^"']*)?)["']/i.exec(block) ||
    /<img[^>]+src=["']([^"']+)["']/i.exec(decodeEntities(block));
  if (!m) return null;
  const link = decodeEntities(m[1]).trim();
  return /^https?:\/\//i.test(link) ? { link } : null;
}

function parseFeed(xml) {
  const items = [];

  const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const guid = /<guid[^>]*isPermaLink=["']true["'][^>]*>([^<]+)<\/guid>/i.exec(block);
    const link =
      tagText(block, "link") ||
      (/<link[^>]+href=["']([^"']+)["']/i.exec(block) || [])[1] ||
      (guid ? guid[1] : "") ||
      (/<item[^>]+rdf:about=["']([^"']+)["']/i.exec(match[0]) || [])[1] ||
      "";
    items.push({
      title: tagText(block, "title"),
      link,
      pubDate: tagText(block, "pubDate") || tagText(block, "dc:date"),
      thumbnail: findImage(block),
    });
  }

  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const alternate =
      /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block) ||
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i.exec(block) ||
      /<link(?![^>]*rel=["'](?:self|enclosure|replies|edit)["'])[^>]*href=["']([^"']+)["']/i.exec(block);
    items.push({
      title: tagText(block, "title"),
      link: alternate ? alternate[1] : "",
      pubDate: tagText(block, "published") || tagText(block, "updated"),
      thumbnail: findImage(block),
    });
  }

  return items
    .map((item) => ({ ...item, title: cleanText(item.title), link: cleanLink(item.link) }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

// --- Dates ---

function parseArticleDate(pubDate) {
  if (!pubDate) return null;
  const raw = String(pubDate).trim();
  if (!raw) return null;

  // RFC 2822 with GMT / UTC / numeric offset (+0300)
  if (/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}(:\d{2})? (GMT|UTC|[+-]\d{4})$/.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }

  // ISO 8601 with Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(raw)) return Date.parse(raw);

  // ISO 8601 without timezone: treat as UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return Date.parse(raw + "Z");

  // ISO 8601 with explicit offset, "+03:00" or "+0300"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/.test(raw)) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
    const t2 = Date.parse(raw.slice(0, -5) + ":" + raw.slice(-5));
    return Number.isFinite(t2) ? t2 : null;
  }

  // "YYYY-MM-DD HH:MM:SS" — UTC unless that lands in the future, then Sofia time
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (local) {
    const [, y, mo, d, h, mi, s] = local.map(Number);
    const utc = Date.UTC(y, mo - 1, d, h, mi, s);
    if (utc <= Date.now()) return utc;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: SOURCE_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      })
        .formatToParts(new Date(utc))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    );
    const shifted = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return utc - (shifted - utc);
  }

  // Anything else Date can read (e.g. "Wed, 2 Oct 2026 10:00:00 EST")
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function normalizePubDate(pubDate) {
  const ts = parseArticleDate(pubDate);
  if (ts !== null) return new Date(ts).toISOString();
  return pubDate ? String(pubDate).trim() : null;
}

function isWithinAge(pubDate, hours) {
  const ts = parseArticleDate(pubDate);
  if (ts === null) return true;
  return (Date.now() - ts) / 3600000 <= hours;
}

// --- Source helpers ---

// Google News appends " - Publisher" to every title; drop it from the
// headline but keep the publisher name.
function googlePublisher(title) {
  const m = /\s[-–]\s([^-–]{2,60})$/.exec(String(title || ""));
  return m ? m[1].trim() : null;
}

function stripPublisherSuffix(title) {
  return String(title || "").replace(/\s[-–]\s[^-–]{2,60}$/, "").trim();
}

function sourceMeta(source, publisher) {
  const meta = { name: source.name, color: source.color };
  if (source.lang) meta.lang = source.lang;
  if (publisher && publisher !== source.name) meta.publisher = publisher;
  return meta;
}

function toArticles(source, items, viaGoogle, maxAgeHours) {
  return items
    .map((item) => ({
      title: viaGoogle ? stripPublisherSuffix(item.title) : item.title,
      link: item.link,
      pubDate: normalizePubDate(item.pubDate),
      thumbnail: item.thumbnail,
      source: sourceMeta(source, viaGoogle ? googlePublisher(item.title) : null),
    }))
    .filter((item) => isWithinAge(item.pubDate, maxAgeHours))
    .sort((a, b) => (parseArticleDate(b.pubDate) || 0) - (parseArticleDate(a.pubDate) || 0))
    .slice(0, source.limit || DEFAULT_LIMIT);
}

async function fetchOneUrl(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRIES_PER_URL; attempt++) {
    try {
      const { status, data } = await withHostSlot(url, () => fetchUrl(url));
      if (status >= 200 && status < 300) return { items: parseFeed(data) };
      lastError = "HTTP " + status;
      // 4xx other than 429 will not get better on retry
      if (status >= 400 && status < 500 && status !== 429) break;
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < RETRIES_PER_URL) await delay(1500 * attempt);
  }
  return { items: [], error: lastError };
}

// Try the direct feed, then the fallback. Returns articles plus a health row.
async function fetchSource(source, maxAgeHours) {
  const started = Date.now();
  const attempts = [source.url, source.fallback].filter(Boolean);
  const errors = [];

  for (let i = 0; i < attempts.length; i++) {
    const url = attempts[i];
    const { items, error } = await fetchOneUrl(url);
    const articles = toArticles(source, items, url.includes("news.google.com"), maxAgeHours);
    if (articles.length > 0) {
      return {
        articles,
        health: {
          source: source.name,
          status: i === 0 ? "ok" : "fallback",
          url,
          items: articles.length,
          ms: Date.now() - started,
          ...(errors.length ? { errors } : {}),
        },
      };
    }
    errors.push(new URL(url).hostname + ": " + (error || (items.length ? "no fresh items" : "empty feed")));
  }

  return {
    articles: [],
    health: { source: source.name, status: "failed", items: 0, ms: Date.now() - started, errors },
  };
}

// --- Dedupe ---

function dedupeKey(item) {
  try {
    const url = new URL(item.link);
    return url.hostname.toLowerCase().replace(/^www\./, "") + url.pathname.replace(/\/+$/, "");
  } catch (_) {
    return (item.source?.name || "") + "::" + (item.title || "").trim().toLowerCase();
  }
}

const titleKey = (item) => (item.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Drop repeats by link and by headline (e.g. the same story from a direct
// feed and from a Google News fallback). First occurrence wins.
function dedupe(items) {
  const seenLinks = new Set();
  const seenTitles = new Set();
  return items.filter((item) => {
    const lk = dedupeKey(item);
    const tk = titleKey(item);
    if (seenLinks.has(lk) || (tk && seenTitles.has(tk))) return false;
    seenLinks.add(lk);
    if (tk) seenTitles.add(tk);
    return true;
  });
}

// --- Persistence ---

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    console.log("⚠️  Could not read " + path.basename(file));
  }
  return fallback;
}

function writeJson(file, data) {
  // Write to a temp file and rename, so the site never serves half a file
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function updateArchive(freshItems) {
  const now = new Date();
  const archive = readJson(ARCHIVE_FILE, { items: [] });
  const cutoff = now.getTime() - ARCHIVE_WINDOW_HOURS * 3600000;

  const seen = new Map();
  for (const item of archive.items || []) seen.set(dedupeKey(item), item);

  let added = 0;
  for (const item of freshItems) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.set(key, { ...item, firstSeen: now.toISOString() });
    added++;
  }

  const kept = [...seen.values()].filter((item) => {
    const firstSeen = Date.parse(item.firstSeen || "");
    if (!Number.isNaN(firstSeen) && firstSeen < cutoff) return false;
    return isWithinAge(item.pubDate, ARCHIVE_WINDOW_HOURS);
  });
  kept.sort((a, b) => (Date.parse(b.firstSeen || b.pubDate) || 0) - (Date.parse(a.firstSeen || a.pubDate) || 0));

  writeJson(ARCHIVE_FILE, {
    windowStart: archive.windowStart || now.toISOString(),
    windowHours: ARCHIVE_WINDOW_HOURS,
    lastUpdated: now.toISOString(),
    totalItems: kept.length,
    items: kept,
  });
  console.log("🗄️  news-24h.json: +" + added + " new, -" + (seen.size - kept.length) + " expired, " + kept.length + " total");
}

// --- Main feed ---

async function fetchMain() {
  const existing = (readJson(OUTPUT_FILE, { items: [] }).items || [])
    .filter((item) => isWithinAge(item.pubDate, MAX_ARTICLE_AGE_HOURS))
    .map((item) => ({ ...item, title: cleanText(item.title) }));

  const results = await mapPool(RSS_SOURCES, CONCURRENCY, (source) =>
    fetchSource(source, MAX_ARTICLE_AGE_HOURS),
  );

  const all = [];
  const health = [];
  results.forEach(({ articles, health: row }, i) => {
    const source = RSS_SOURCES[i];
    if (articles.length === 0) {
      // Keep the last good items from this source so it does not vanish
      const old = existing.filter((item) => item.source?.name === source.name);
      if (old.length) {
        row.status = "stale";
        row.keptOld = old.length;
        all.push(...old);
      }
    } else {
      all.push(...articles);
    }
    health.push(row);
  });

  if (all.length === 0) {
    writeJson(HEALTH_FILE, { lastRun: new Date().toISOString(), sources: health });
    throw new Error("No items fetched from any source");
  }

  // Direct-feed items first so a Google News duplicate is the one dropped
  const viaGoogle = (item) => (item.link.includes("news.google.com") ? 1 : 0);
  const items = dedupe([...all].sort((a, b) => viaGoogle(a) - viaGoogle(b))).sort(
    (a, b) => (parseArticleDate(b.pubDate) || 0) - (parseArticleDate(a.pubDate) || 0),
  );

  const lastUpdated = new Date().toISOString();
  writeJson(OUTPUT_FILE, { items, lastUpdated });
  updateArchive(items);
  writeJson(HEALTH_FILE, { lastRun: lastUpdated, sources: health });

  printHealth(health);
  const withImages = items.filter((item) => item.thumbnail).length;
  console.log("\n✅ news.json: " + items.length + " articles (" + (all.length - items.length) + " duplicates dropped, " + withImages + " with images)");
  return health;
}

function printHealth(rows) {
  const icon = { ok: "✅", fallback: "↪️ ", stale: "📦", failed: "❌" };
  console.log("\n📡 Sources:");
  for (const r of rows) {
    const extra = r.status === "stale" ? " (kept " + r.keptOld + " old)" : r.status === "fallback" ? " via " + new URL(r.url).hostname : "";
    console.log("  " + icon[r.status] + " " + r.source.padEnd(20) + String(r.items).padStart(2) + " items  " + String(r.ms).padStart(6) + "ms" + extra);
    if (r.errors && r.status !== "ok") for (const e of r.errors) console.log("       " + e);
  }
}

// --- Entry point ---

if (require.main === module) {
  const started = Date.now();
  fetchMain()
    .then(() => console.log("🕐 Done in " + ((Date.now() - started) / 1000).toFixed(1) + "s"))
    .catch((error) => {
      console.error("❌ " + error.message);
      process.exit(1);
    });
}

module.exports = { parseFeed, parseArticleDate, cleanText, cleanLink, dedupe, fetchSource };
