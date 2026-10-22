#!/usr/bin/env node

// Daily top-news helper.
//
//   node news-daily.js digest   -> news-digest.md  (compact AI input)
//   node news-daily.js clean    -> repairs/validates the AI's top-news.json
//   node news-daily.js links    -> checks each story's link against its source lines
//   node news-daily.js archive  -> saves top-news.json as news/data/digests/<date>.json
//   node news-daily.js reset    -> clears news-24h.json for the next window
//   node news-daily.js discord  -> discord-message.txt (ready-to-post #news text)
//
// The digest is deliberately tiny (one line per article) so the AI call stays
// cheap: no links, no images, no timestamps — only what is needed to group
// duplicate stories and name the sources.

const fs = require("fs");
const path = require("path");

const ARCHIVE_FILE = path.join(__dirname, "data", "news-24h.json");
const DIGEST_FILE = path.join(__dirname, "data", "news-digest.md");
const TOP_NEWS_FILE = path.join(__dirname, "data", "top-news.json");
const DIGEST_MAP_FILE = path.join(__dirname, "data", "news-digest-map.json");
const DISCORD_FILE = path.join(__dirname, "data", "discord-message.txt");

const CATEGORIES = [
  "Политика", "Икономика", "Общество", "Свят", "Технологии",
  "Култура", "Спорт", "Здравеопазване", "Екология", "Други",
];
const MAX_STORIES = 5;

// --- Clean ---
// The summarising agent is a small model: accept slightly malformed output
// (code fences, text around the JSON, wrong category, extra fields, too many
// stories) and normalise it, so only truly unusable output fails the run.
function clean() {
  if (!fs.existsSync(TOP_NEWS_FILE)) fail("top-news.json missing");
  const raw = fs.readFileSync(TOP_NEWS_FILE, "utf8");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    fail(`top-news.json is not valid JSON (${error.message})`);
  }

  const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const stories = (Array.isArray(data.stories) ? data.stories : [])
    .map((s) => ({
      category: CATEGORIES.find((c) => c.toLowerCase() === text(s.category).toLowerCase()) || "Други",
      headline: text(s.headline).replace(/[.!]+$/, ""),
      summary: text(s.summary),
      ids: (Array.isArray(s.ids) ? s.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    }))
    .filter((s) => s.headline && s.summary)
    .slice(0, MAX_STORIES);

  if (stories.length === 0) fail("top-news.json has no usable stories");
  if (!text(data.overview)) fail("top-news.json has no overview");

  const out = { updatedAt: new Date().toISOString(), overview: text(data.overview), stories };
  fs.writeFileSync(TOP_NEWS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ top-news.json OK — ${stories.length} stories`);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// --- Discord ---
// Built from the final top-news.json so the agent posts it verbatim instead
// of re-typing the digest (saves tokens and avoids formatting mistakes).
function discord() {
  const top = JSON.parse(fs.readFileSync(TOP_NEWS_FILE, "utf8"));
  const date = new Intl.DateTimeFormat("bg-BG", {
    timeZone: "Europe/Sofia", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(top.updatedAt || Date.now())).replace(/\s*г\.$/, "");
  const blocks = top.stories.map(
    (s, i) => `*${i + 1}. ${s.category}* — ${s.headline}\n${s.summary}\n📌 Източници: ${(s.sources || []).join(", ")}`,
  );
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(top.updatedAt || Date.now()));
  const message = [
    `@everyone 📰 Дневни новини — ${date}`,
    `*${top.overview}*`,
    "━━━━━━━━━━━━━━━",
    blocks.join("\n\n"),
    `🔗 https://www.technotavern.com/obzor/${day}/`,
  ].join("\n\n");
  fs.writeFileSync(DISCORD_FILE, message + "\n");
  console.log(`✅ ${path.relative(path.join(__dirname, ".."), DISCORD_FILE)} ready`);
}

function readArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    console.error("❌ news-24h.json not found");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
  return Array.isArray(data.items) ? data : { ...data, items: [] };
}

// Lines given to the AI: "id|source|title" only. Links are long (Google News
// URLs are ~300 chars) and the AI does not need them; they go to a sidecar
// file and `links` attaches them afterwards from the story ids.
function writeDigest(items, note) {
  const usable = items.filter((item) => item.title && item.source?.name && item.link);
  const lines = [];
  const map = {};
  usable.forEach((item, i) => {
    const id = i + 1;
    const title = item.title.replace(/\s+/g, " ").trim();
    lines.push(`${id}|${item.source.name}|${title}`);
    map[id] = { source: item.source.name, title, link: item.link };
  });
  fs.writeFileSync(DIGEST_FILE, lines.length ? lines.join("\n") + "\n" : "");
  fs.writeFileSync(DIGEST_MAP_FILE, JSON.stringify(map));
  console.log(`✅ news-digest.md — ${lines.length} articles${note ? ` (${note})` : ""}`);
  return lines.length;
}

function digest() {
  const archive = readArchive();
  if (writeDigest(archive.items) > 0) return;

  // 24h window was cleared (finish's news:reset) — fall back to the active
  // news.json feed so the AI still has material to summarize.
  const feedPath = path.join(__dirname, "data", "news.json");
  if (fs.existsSync(feedPath)) {
    console.warn("⚠️ No articles in the 24h window; falling back to news.json");
    const feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));
    writeDigest(Array.isArray(feed.items) ? feed.items : feed, "from news.json fallback");
  }
}

function reset() {
  if (!fs.existsSync(TOP_NEWS_FILE)) {
    console.error("❌ top-news.json missing — refusing to clear the archive");
    process.exit(1);
  }

  // Sanity check: only clear once the AI actually produced a headline.
  const top = JSON.parse(fs.readFileSync(TOP_NEWS_FILE, "utf8"));
  if (!top.overview || !Array.isArray(top.stories) || top.stories.length === 0) {
    console.error(
      "❌ top-news.json is incomplete — refusing to clear the archive",
    );
    process.exit(1);
  }

  const now = new Date().toISOString();
  fs.writeFileSync(
    ARCHIVE_FILE,
    JSON.stringify(
      {
        windowStart: now,
        windowHours: 24,
        lastUpdated: now,
        totalItems: 0,
        items: [],
      },
      null,
      2,
    ),
  );

  for (const f of [DIGEST_FILE, DIGEST_MAP_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);

  console.log(`✅ news-24h.json cleared — new window starts ${now}`);
}

// --- Link check ---
// The AI picks story.link itself and sometimes copies the URL of a different
// line. Each story lists the digest line ids it was built from, so the link is
// re-derived from those lines: the article whose title best matches the
// headline + summary wins, preferring direct publisher URLs over Google News
// redirects. Sources are recomputed from the same lines.

// Bulgarian is heavily inflected, so words are compared by a 5-letter stem.
function stems(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
}

function overlap(a, b) {
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return { ratio: a.size ? hits / a.size : 0, hits };
}

function readDigestLines() {
  if (!fs.existsSync(DIGEST_MAP_FILE)) return new Map();
  const map = JSON.parse(fs.readFileSync(DIGEST_MAP_FILE, "utf8"));
  return new Map(Object.entries(map).map(([id, line]) => [Number(id), line]));
}

// A line "matches" a story when at least MIN_HITS of its title stems, and at
// least MIN_MATCH of all of them, appear in the story's headline + summary.
const MIN_MATCH = 0.3;
const MIN_HITS = 3;

// The AI writes only category/headline/summary/ids. This fills in
// link (best-matching article, preferring the story's own ids and direct
// publisher URLs), sources and updatedAt.
function links() {
  const lines = readDigestLines();
  const top = JSON.parse(fs.readFileSync(TOP_NEWS_FILE, "utf8"));
  top.updatedAt = top.updatedAt || new Date().toISOString();
  if (lines.size === 0) {
    console.warn("⚠️ news-digest-map.json missing — links not checked");
    fs.writeFileSync(TOP_NEWS_FILE, JSON.stringify(top, null, 2) + "\n");
    return;
  }
  const all = [...lines.entries()].map(([id, line]) => ({ id, ...line, stems: stems(line.title) }));
  let filled = 0;

  for (const story of top.stories || []) {
    const ownIds = new Set((story.ids || []).map(Number));
    const own = all.filter((c) => ownIds.has(c.id));
    const target = stems(`${story.headline} ${story.summary}`);
    const scored = all
      .map((c) => {
        const { ratio, hits } = overlap(c.stems, target);
        const match = hits >= MIN_HITS ? ratio : 0;
        const bonus = (ownIds.has(c.id) ? 0.1 : 0) + (c.link.includes("news.google.com") ? 0 : 0.05);
        return { ...c, match, score: match + bonus };
      })
      .sort((x, y) => y.score - x.score);

    const best = scored[0]?.match >= MIN_MATCH ? scored[0] : null;
    const fallback = own.find((c) => !c.link.includes("news.google.com")) || own[0];
    const pick = best || fallback;
    if (!pick) {
      console.warn(`⚠️ No source found for "${story.headline}"`);
      continue;
    }
    if (!best) console.warn(`⚠️ Weak match for "${story.headline}" — using its first id`);
    if (story.link !== pick.link) filled++;
    story.link = pick.link;

    const covering = [...own, ...scored.filter((c) => c.match >= MIN_MATCH)].map((c) => c.source);
    story.sources = [...new Set(covering)];
    story.ids = [...ownIds];
  }

  fs.writeFileSync(TOP_NEWS_FILE, JSON.stringify(top, null, 2) + "\n");
  console.log(`✅ Links set for ${filled} stor${filled === 1 ? "y" : "ies"}`);
}

// --- Archive ---
// One file per Sofia calendar day; scripts/build-pages.js turns these into
// /obzor/<date>/ pages, the /obzor/ index, feed.xml and the news sitemap.
const DIGESTS_DIR = path.join(__dirname, "data", "digests");

function sofiaDate(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(iso));
}

function archive() {
  const top = JSON.parse(fs.readFileSync(TOP_NEWS_FILE, "utf8"));
  if (!top.updatedAt || !Array.isArray(top.stories) || top.stories.length === 0) {
    console.error("❌ top-news.json incomplete — not archiving");
    process.exit(1);
  }
  fs.mkdirSync(DIGESTS_DIR, { recursive: true });
  const file = path.join(DIGESTS_DIR, `${sofiaDate(top.updatedAt)}.json`);
  fs.writeFileSync(file, JSON.stringify(top, null, 2) + "\n");
  console.log(`✅ Archived digest → ${path.relative(path.join(__dirname, ".."), file)}`);
}

const command = process.argv[2];
if (command === "digest") digest();
else if (command === "clean") clean();
else if (command === "discord") discord();
else if (command === "links") links();
else if (command === "archive") archive();
else if (command === "reset") reset();
else {
  console.error("Usage: node news-daily.js <digest|clean|links|archive|reset|discord>");
  process.exit(1);
}
