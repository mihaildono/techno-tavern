#!/usr/bin/env node
// Notifies IndexNow (Bing, Yandex, Seznam, Naver) that pages changed, so they
// recrawl within minutes instead of days. Run after each push.
// The key file /8cce13b196e3062594dcdb8a59b40430.txt at the site root proves we own the domain.

const fs = require("fs");
const path = require("path");

const HOST = "www.technotavern.com";
const KEY = "8cce13b196e3062594dcdb8a59b40430";

function latestDigestUrl() {
  const dir = path.join(__dirname, "..", "news", "data", "digests");
  if (!fs.existsSync(dir)) return null;
  const latest = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
  return latest ? `https://${HOST}/obzor/${latest.slice(0, 10)}/` : null;
}

async function main() {
  const urlList = [
    `https://${HOST}/`,
    `https://${HOST}/obzor/`,
    latestDigestUrl(),
  ].filter(Boolean);

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(15000),
  });
  // 200 = accepted, 202 = accepted (key check pending)
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow HTTP ${res.status}`);
  console.log(`IndexNow: ${urlList.length} URL(s) submitted (HTTP ${res.status})`);
}

main().catch((error) => {
  console.error(`IndexNow failed: ${error.message}`);
  process.exit(1);
});
