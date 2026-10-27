#!/usr/bin/env node

// Social media cards for the evening digest (Instagram carousel / Facebook post).
//
//   node scripts/social-cards.js [YYYY-MM-DD]
//
// Reads news/data/digests/<date>.json (default: newest), fills
// scripts/social-card.html once per card and screenshots it with Playwright.
// Output in news/data/social/<date>/:
//   01-cover.jpg, 02-story.jpg, ...   1080x1350 (4:5), JPEG because the Instagram API only takes JPEG
//   facebook.txt, instagram.txt       post captions
// Posting: scripts/social-post.js. No AI. Playwright's Chromium lives in
// node_modules (`npm install` fetches it via postinstall), nothing system-wide.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

process.env.PLAYWRIGHT_BROWSERS_PATH = "0"; // must match the postinstall script in package.json
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const DIGESTS_DIR = path.join(ROOT, "news", "data", "digests");
const SOCIAL_DIR = path.join(ROOT, "news", "data", "social");
const TEMPLATE = fs.readFileSync(path.join(__dirname, "social-card.html"), "utf8");
const SITE = "technotavern.com";

const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const HASHTAGS = "#новини #България #Пловдив #TechnoTavern #вечеренобзор";
const IG_CAPTION_MAX = 2200;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function formatDate(date, opts) {
  return new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", ...opts }).format(new Date(`${date}T12:00:00Z`));
}

function header(date) {
  return `<header class="head">
  <img src="assets/logo.svg" alt="" />
  <div class="brand">Techno Tavern<span>ВЕЧЕРЕН ОБЗОР</span></div>
  <div class="date"><b>${esc(formatDate(date, { day: "numeric", month: "long" }))}</b>${esc(formatDate(date, { weekday: "long" }))}</div>
</header>`;
}

// --- Captions ---
// Facebook: links are clickable, so full summaries + link to the obzor page.
// Instagram: captions can't link, the slides carry the summaries.
function captions(digest, date) {
  const title = `📰 Вечерен обзор · ${formatDate(date, { day: "numeric", month: "long" })}`;
  const url = `https://${SITE}/obzor/${date}/`;
  const facebook = [
    title,
    digest.overview,
    ...digest.stories.map((s, i) => `${KEYCAPS[i]} ${s.headline}\n${s.summary}`),
    `👉 Пълният обзор с линкове към източниците:\n${url}`,
  ].join("\n\n");

  const tail = ["Подробности за всяка новина в слайдовете 👉", `🔗 Пълният обзор: линк в профила · ${SITE}`, HASHTAGS];
  const head = [title, digest.overview, digest.stories.map((s, i) => `${KEYCAPS[i]} ${s.headline}`).join("\n")];
  let instagram = [...head, ...tail].join("\n\n");
  if (instagram.length > IG_CAPTION_MAX) instagram = [title, head[2], ...tail].join("\n\n");
  return { facebook: `${facebook}\n`, instagram: `${instagram}\n` };
}

function footer(index, total, note) {
  return `<footer class="foot"><span class="url">${SITE}</span><span>${note}</span><span>${index}/${total}</span></footer>`;
}

function coverCard(digest, date, total) {
  const items = digest.stories
    .map((s, i) => `<li><span class="n">${i + 1}</span><span class="t"><span class="c">${esc(s.category)}</span>${esc(s.headline)}</span></li>`)
    .join("\n    ");
  return `${header(date)}
<main>
  <h1 class="kicker">Новините <em>за деня</em></h1>
  <p class="overview" data-fit style="max-height: 260px">${esc(digest.overview)}</p>
  <ol class="list" data-fit>
    ${items}
  </ol>
</main>
${footer(1, total, '<span class="swipe">Плъзни за подробности →</span>')}`;
}

function storyCard(story, i, date, total) {
  const sources = story.sources?.length
    ? `<p class="sources"><b>${story.sources.length} ${story.sources.length === 1 ? "източник" : "източника"}:</b> ${esc(story.sources.join(" · "))}</p>`
    : "";
  return `${header(date)}
<main>
  <div class="story-top"><span class="chip">${esc(story.category)}</span><span class="num">${pad(i + 1)}</span></div>
  <h2 class="headline" data-fit>${esc(story.headline)}</h2>
  <div class="rule"></div>
  <p class="summary" data-fit>${esc(story.summary)}</p>
  ${sources}
</main>
${footer(i + 2, total, "Пълният обзор в сайта")}`;
}

// Served from a temp file (not setContent) so the file:// base can load the logo.
async function screenshot(page, html, outFile) {
  const tmp = path.join(os.tmpdir(), `tt-card-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  try {
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
    await page.screenshot({ path: outFile, type: "jpeg", quality: 90 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function main() {
  const date = process.argv[2] || fs.readdirSync(DIGESTS_DIR).filter((f) => f.endsWith(".json")).sort().pop()?.slice(0, -5);
  const file = path.join(DIGESTS_DIR, `${date}.json`);
  if (!date || !fs.existsSync(file)) fail(`No digest for ${date || "any date"} in news/data/digests/`);
  const digest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!digest.stories?.length) fail(`Digest ${date} has no stories`);

  const outDir = path.join(SOCIAL_DIR, date);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const total = digest.stories.length + 1;
  const cards = [
    ["01-cover", coverCard(digest, date, total)],
    ...digest.stories.map((s, i) => [`${pad(i + 2)}-story`, storyCard(s, i, date, total)]),
  ];
  const page = (body) => TEMPLATE.replace("{{BASE}}", `file://${ROOT}/`).replace("<!--CARD-->", body);

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    for (const [name, body] of cards) {
      const out = path.join(outDir, `${name}.jpg`);
      await screenshot(tab, page(body), out);
      console.log(`🖼  ${path.relative(ROOT, out)}`);
    }
  } finally {
    await browser.close();
  }
  const text = captions(digest, date);
  fs.writeFileSync(path.join(outDir, "facebook.txt"), text.facebook);
  fs.writeFileSync(path.join(outDir, "instagram.txt"), text.instagram);
  console.log(`✅ ${cards.length} cards + captions for ${date}`);
}

main().catch((error) => fail(error.message));
