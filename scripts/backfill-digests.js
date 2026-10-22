#!/usr/bin/env node
// One-off: rebuild news/data/digests/<date>.json from the git history of
// news/data/top-news.json, so the /obzor/ archive starts with every digest
// published so far. Existing files are kept unless --force is passed.
//
//   node scripts/backfill-digests.js [--force]

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { isoDay, parseTime } = require("./site-pages");

const ROOT = path.join(__dirname, "..");
const FILE = "news/data/top-news.json";
const OUT = path.join(ROOT, "news", "data", "digests");
const force = process.argv.includes("--force");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const commits = git("log", "--reverse", "--format=%H", "--", FILE).split("\n").filter(Boolean);
const byDay = new Map(); // later commits overwrite earlier ones for the same day

for (const hash of commits) {
  let data;
  try {
    data = JSON.parse(git("show", `${hash}:${FILE}`));
  } catch (_) {
    continue;
  }
  const time = parseTime(data.updatedAt);
  const stories = (data.stories || []).filter((s) => s && s.headline && s.summary);
  if (!time || stories.length === 0) continue;
  byDay.set(isoDay(time), { ...data, updatedAt: time.toISOString(), stories });
}

fs.mkdirSync(OUT, { recursive: true });
let written = 0;
for (const [day, data] of byDay) {
  const file = path.join(OUT, `${day}.json`);
  if (fs.existsSync(file) && !force) continue;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  written++;
}
console.log(`Scanned ${commits.length} commits, ${byDay.size} days with a digest, wrote ${written} file(s) to news/data/digests/`);
