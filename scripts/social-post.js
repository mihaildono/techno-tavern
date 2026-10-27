#!/usr/bin/env node

// Posts the cards from scripts/social-cards.js to the Facebook Page and Instagram.
//
//   node scripts/social-post.js [YYYY-MM-DD] [--dry-run] [--only=facebook|instagram] [--auto]
//
// Uses the Meta Graph API with plain fetch (no SDK). Flow:
//   1. Every card is uploaded to the Page as an unpublished photo. Its Facebook
//      CDN URL is the public image URL Instagram needs, so no hosting of our own.
//   2. Facebook: one feed post with facebook.txt and the cover (FACEBOOK_IMAGES=all: every card).
//   3. Instagram: carousel of all cards with instagram.txt.
// Each platform is marked in news/data/social/<date>.posted.json after success,
// so re-running never posts twice (delete the file to force a repost).
// --auto (used by daily-top-news.sh): does nothing unless AUTO_POST=1.
// After a posting attempt, news/data/social/discord-message.txt holds a report
// (post links or errors) for the cron job to send to Discord; no attempt, no file.
//
// Config: environment, or KEY=VALUE lines in .env at the repo root (gitignored; SOCIAL_ENV overrides the path):
//   META_PAGE_ID, META_PAGE_TOKEN (Page token: pages_manage_posts, pages_read_engagement,
//   instagram_basic, instagram_content_publish), META_IG_USER_ID,
//   optional META_GRAPH_VERSION (default v23.0), FACEBOOK_IMAGES (cover|all), AUTO_POST (1).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOCIAL_DIR = path.join(ROOT, "news", "data", "social");
const ENV_FILE = process.env.SOCIAL_ENV || path.join(ROOT, ".env");
const MESSAGE_FILE = path.join(SOCIAL_DIR, "discord-message.txt");
const LABELS = { facebook: "Facebook", instagram: "Instagram" };

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const DRY_RUN = Boolean(flag("dry-run"));
const ONLY = flag("only")?.split("=")[1];

// Under --auto, also leave a report (unless a more detailed one exists) so the error reaches Discord.
function fail(message) {
  console.error(`❌ ${message}`);
  if (flag("auto") && !fs.existsSync(MESSAGE_FILE)) {
    fs.mkdirSync(SOCIAL_DIR, { recursive: true });
    fs.writeFileSync(MESSAGE_FILE, `📣 Social posts\n❌ ${message}\n`);
  }
  process.exit(1);
}

function loadConfig() {
  const config = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match) config[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  for (const key of Object.keys(process.env)) if (/^(META_|FACEBOOK_|AUTO_POST)/.test(key)) config[key] = process.env[key];
  return config;
}

const config = loadConfig();
const GRAPH = `https://graph.facebook.com/${config.META_GRAPH_VERSION || "v23.0"}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function graph(method, endpoint, params = {}) {
  const body = params instanceof FormData ? params : new URLSearchParams(params);
  body.append("access_token", config.META_PAGE_TOKEN);
  const url = method === "GET" ? `${GRAPH}/${endpoint}?${body}` : `${GRAPH}/${endpoint}`;
  const response = await fetch(url, method === "GET" ? {} : { method, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(`${endpoint}: ${data.error?.message || response.status}`);
  return data;
}

// Unpublished Page photo → { id, url } where url is its public CDN copy.
async function uploadPhoto(file) {
  const form = new FormData();
  form.append("published", "false");
  form.append("source", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
  const { id } = await graph("POST", `${config.META_PAGE_ID}/photos`, form);
  const { images } = await graph("GET", id, { fields: "images" });
  const largest = images.sort((a, b) => b.width - a.width)[0];
  return { id, url: largest.source };
}

async function postFacebook(photos, message) {
  const attach = config.FACEBOOK_IMAGES === "all" ? photos : photos.slice(0, 1);
  const params = { message };
  attach.forEach((p, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: p.id })));
  const { id } = await graph("POST", `${config.META_PAGE_ID}/feed`, params);
  return id;
}

async function waitForContainer(id) {
  for (let i = 0; i < 30; i++) {
    const { status_code: status } = await graph("GET", id, { fields: "status_code" });
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram container ${id}: ${status}`);
    await sleep(3000);
  }
  throw new Error(`Instagram container ${id}: timed out`);
}

async function postInstagram(photos, caption) {
  const ig = config.META_IG_USER_ID;
  const children = [];
  for (const photo of photos) {
    const { id } = await graph("POST", `${ig}/media`, { image_url: photo.url, is_carousel_item: "true" });
    children.push(id);
  }
  for (const id of children) await waitForContainer(id);
  const { id: carousel } = await graph("POST", `${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  await waitForContainer(carousel);
  const { id } = await graph("POST", `${ig}/media_publish`, { creation_id: carousel });
  return id;
}

// Public link of a finished post, or null (the report then shows the id only).
async function permalink(target, id) {
  try {
    const field = target === "facebook" ? "permalink_url" : "permalink";
    return (await graph("GET", id, { fields: field }))[field] || null;
  } catch {
    return null;
  }
}

async function main() {
  fs.rmSync(MESSAGE_FILE, { force: true }); // never resend an old report
  if (flag("auto") && config.AUTO_POST !== "1") {
    console.log("ℹ️ Social posting skipped (AUTO_POST is not 1)");
    return;
  }

  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
    fs.readdirSync(SOCIAL_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().pop();
  const dir = date && path.join(SOCIAL_DIR, date);
  if (!dir || !fs.existsSync(dir)) fail(`No cards for ${date || "any date"} — run scripts/social-cards.js first`);

  const images = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(dir, f));
  const text = (name) => fs.readFileSync(path.join(dir, name), "utf8").trim();
  const markerFile = path.join(SOCIAL_DIR, `${date}.posted.json`);
  const posted = fs.existsSync(markerFile) ? JSON.parse(fs.readFileSync(markerFile, "utf8")) : {};
  const targets = ["facebook", "instagram"].filter((t) => (!ONLY || ONLY === t) && !posted[t]);
  if (images.length === 0) fail(`No images in ${path.relative(ROOT, dir)}`);
  if (images.length > 10) fail("Instagram carousels take at most 10 images");

  if (targets.length === 0) {
    console.log(`ℹ️ ${date} already posted: ${JSON.stringify(posted)}`);
    return;
  }

  if (DRY_RUN) {
    console.log(`Would post ${date} to ${targets.join(" + ")} with ${images.length} images:`);
    images.forEach((f) => console.log(`  ${path.relative(ROOT, f)}`));
    for (const t of targets) console.log(`\n--- ${t}.txt ---\n${text(`${t}.txt`)}`);
    return;
  }

  const missing = ["META_PAGE_ID", "META_PAGE_TOKEN", ...(targets.includes("instagram") ? ["META_IG_USER_ID"] : [])].filter((k) => !config[k]);
  if (missing.length) fail(`Missing config: ${missing.join(", ")} (env or ${ENV_FILE})`);

  const report = [`📣 Social posts · ${date}`];
  const writeReport = () => fs.writeFileSync(MESSAGE_FILE, report.join("\n") + "\n");

  const photos = [];
  try {
    console.log(`Uploading ${images.length} images to the Page...`);
    for (const file of images) photos.push(await uploadPhoto(file));
  } catch (error) {
    report.push(`❌ Image upload failed, nothing posted: ${error.message}`);
    writeReport();
    fail(error.message);
  }

  let failed = false;
  for (const target of targets) {
    try {
      const id = target === "facebook" ? await postFacebook(photos, text("facebook.txt")) : await postInstagram(photos, text("instagram.txt"));
      posted[target] = { id, at: new Date().toISOString() };
      fs.writeFileSync(markerFile, JSON.stringify(posted, null, 2) + "\n");
      report.push(`✅ ${LABELS[target]}: ${(await permalink(target, id)) || id}`);
      console.log(`✅ ${target}: ${id}`);
    } catch (error) {
      failed = true;
      report.push(`❌ ${LABELS[target]}: ${error.message}`);
      console.error(`❌ ${target}: ${error.message}`);
    }
  }
  writeReport();
  if (failed) process.exit(1);
}

main().catch((error) => fail(error.message));
