#!/usr/bin/env node

// Daily top-news helper.
//
//   node news-daily.js digest   -> news-digest.txt  (compact AI input)
//   node news-daily.js reset    -> clears news-24h.json for the next window
//
// The digest is deliberately tiny (one line per article) so the AI call stays
// cheap: no links, no images, no timestamps — only what is needed to group
// duplicate stories and name the sources.

const fs = require("fs");
const path = require("path");

const ARCHIVE_FILE = path.join(__dirname, "news-24h.json");
const DIGEST_FILE = path.join(__dirname, "news-digest.txt");
const TOP_NEWS_FILE = path.join(__dirname, "top-news.json");

function readArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    console.error("❌ news-24h.json not found");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
  return Array.isArray(data.items) ? data : { ...data, items: [] };
}

function digest() {
  const archive = readArchive();

  const lines = archive.items
    .filter((item) => item.title && item.source?.name)
    .map((item, i) => `${i + 1}|${item.source.name}|${item.title.trim()}`);

  if (lines.length === 0) {
    console.error("❌ No articles in the 24h window");
    process.exit(1);
  }

  fs.writeFileSync(DIGEST_FILE, lines.join("\n") + "\n");
  console.log(`✅ news-digest.txt — ${lines.length} articles`);
}

function reset() {
  if (!fs.existsSync(TOP_NEWS_FILE)) {
    console.error("❌ top-news.json missing — refusing to clear the archive");
    process.exit(1);
  }

  // Sanity check: only clear once the AI actually produced a headline.
  const top = JSON.parse(fs.readFileSync(TOP_NEWS_FILE, "utf8"));
  if (!top.title || !Array.isArray(top.sources) || top.sources.length === 0) {
    console.error("❌ top-news.json is incomplete — refusing to clear the archive");
    process.exit(1);
  }

  const now = new Date().toISOString();
  fs.writeFileSync(
    ARCHIVE_FILE,
    JSON.stringify(
      { windowStart: now, windowHours: 24, lastUpdated: now, totalItems: 0, items: [] },
      null,
      2,
    ),
  );

  if (fs.existsSync(DIGEST_FILE)) fs.unlinkSync(DIGEST_FILE);

  console.log(`✅ news-24h.json cleared — new window starts ${now}`);
}

const command = process.argv[2];
if (command === "digest") digest();
else if (command === "reset") reset();
else {
  console.error("Usage: node news-daily.js <digest|reset>");
  process.exit(1);
}
