#!/usr/bin/env node
// Pre-renders the news data into index.html so crawlers (and no-JS visitors)
// see real headlines, then writes sitemap.xml and robots.txt.
// The markup mirrors what the client script in index.html builds, so the
// same CSS applies; the client replaces it with live data after load.

const fs = require("fs");
const path = require("path");
const pages = require("./site-pages");

const ROOT = path.join(__dirname, "..");
const SITE = "https://www.technotavern.com";
const SOFIA = "Europe/Sofia";

const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

// --- Helpers ---

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function esc(text) {
  return decode(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: SOFIA, hour: "2-digit", hourCycle: "h23" });
const clockFormat = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, day: "numeric", month: "long" });
const dateTimeFormat = new Intl.DateTimeFormat("bg-BG", {
  timeZone: SOFIA, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

function replaceBlock(html, name, content) {
  const start = `<!--${name}:start-->`;
  const end = `<!--${name}:end-->`;
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`Missing ${name} markers in index.html`);
  return html.slice(0, a + start.length) + content + html.slice(b);
}

// --- Renderers ---

function sourcesLine(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  return `<span class="story-sources-label">Източници: </span>${esc(sources.join(", "))}`;
}

// Link to the permanent /obzor/<date>/ page once the digest has been archived
function permalink(top) {
  const time = pages.parseTime(top?.updatedAt);
  if (!time) return "";
  const date = pages.isoDay(time);
  if (!fs.existsSync(path.join(ROOT, "news", "data", "digests", `${date}.json`))) return "";
  return `<p class="digest-permalink"><a href="/obzor/${date}/">Постоянен адрес на обзора</a> · <a href="/obzor/">Всички обзори</a></p>`;
}

function renderDigest(top) {
  const stories = top?.stories;
  if (!stories?.length) return { html: "", stories: [] };
  const [lead, ...rest] = stories;

  const leadHref = safeUrl(lead.link);
  const time = top.updatedAt
    ? `<time id="digest-time" datetime="${esc(top.updatedAt)}">${dateTimeFormat.format(new Date(top.updatedAt))}</time>`
    : '<time id="digest-time"></time>';

  const items = rest
    .map((story) => {
      const href = safeUrl(story.link);
      const link = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(story.headline)}</a>`
        : `<a>${esc(story.headline)}</a>`;
      return `<li class="digest-item"><p class="story-category">${esc(story.category)}</p><h3 class="digest-headline">${link}</h3><p class="digest-summary">${esc(story.summary)}</p><p class="story-sources">${sourcesLine(story.sources)}</p></li>`;
    })
    .join("\n");

  const overview = top.overview
    ? `<details class="digest-overview"><summary>Денят в едно изречение</summary><p id="digest-overview">${esc(top.overview)}</p></details>`
    : "";

  const html = `<section id="digest" class="digest" aria-labelledby="digest-title">
            <p class="digest-dateline"><span id="digest-title">Вечерен обзор</span> ${time}</p>
            <article class="lead">
                <p class="story-category" id="lead-category">${esc(lead.category)}</p>
                <h2 class="lead-headline"><a id="lead-link" ${leadHref ? `href="${esc(leadHref)}" ` : ""}target="_blank" rel="noopener noreferrer">${esc(lead.headline)}</a></h2>
                <p class="lead-summary" id="lead-summary">${esc(lead.summary)}</p>
                <p class="story-sources" id="lead-sources">${sourcesLine(lead.sources)}</p>
            </article>
            <ol class="digest-rest" id="digest-rest" start="2">${items}</ol>
            ${overview}
            ${permalink(top)}
        </section>`;
  return { html, stories };
}

function renderItem(item) {
  const href = safeUrl(item.link);
  if (!href) return "";
  const time = new Date(item.pubDate);
  const thumb = safeUrl(item.thumbnail?.link);
  const img = thumb
    ? `<img class="news-thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="112" height="84" />`
    : "";
  // Relative ages go stale between builds, so the static HTML shows the clock time
  return `<li class="news-item"><a class="news-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><div class="news-text"><span class="news-title"${item.source?.lang ? ` lang="${esc(item.source.lang)}"` : ""}>${esc(item.title)}</span><span class="news-meta"><span class="news-source" style="--source: ${esc(item.source?.color || "var(--malt)")}">${esc(item.source?.name)}</span><span class="news-age">${clockFormat.format(time)}</span></span></div>${img}</a></li>`;
}

function renderTimeline(items) {
  const today = dayFormat.format(new Date());
  const groups = [];
  let currentKey = null;
  for (const item of items) {
    const date = new Date(item.pubDate);
    const day = dayFormat.format(date);
    const key = `${day} ${hourFormat.format(date)}`;
    if (key !== currentKey) {
      currentKey = key;
      const dayLabel = day !== today ? `<span class="hour-day">${day}</span>` : "";
      groups.push({ head: `<h3 class="hour-mark"><time datetime="${date.toISOString()}">${hourFormat.format(date)}:00</time>${dayLabel}</h3>`, items: [] });
    }
    groups[groups.length - 1].items.push(renderItem(item));
  }
  return groups
    .map((g) => `<section class="hour-group">${g.head}<ol class="hour-list">${g.items.join("")}</ol></section>`)
    .join("\n");
}

// --- Structured data ---

function jsonLd(topStories, lastUpdated) {
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: `${SITE}/`,
      name: "Techno Tavern",
      description: "Новини от България и света: независим новинарски обзор без реклами",
      inLanguage: "bg",
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "NewsMediaOrganization",
      "@id": `${SITE}/#org`,
      name: "Techno Tavern",
      url: `${SITE}/`,
      logo: { "@type": "ImageObject", url: `${SITE}/assets/logo.jpeg` },
      areaServed: { "@type": "Country", name: "България", alternateName: "Bulgaria" },
      location: { "@type": "City", name: "Пловдив", alternateName: "Plovdiv" },
      sameAs: ["https://masto.bg/@Technotavern"],
    },
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/#page`,
      url: `${SITE}/`,
      name: "Новини от България и света",
      isPartOf: { "@id": `${SITE}/#website` },
      inLanguage: "bg",
      ...(lastUpdated ? { dateModified: lastUpdated } : {}),
    },
  ];
  const listed = topStories
    .map((story, i) => ({ "@type": "ListItem", position: i + 1, name: decode(story.headline), url: safeUrl(story.link) }))
    .filter((entry) => entry.url);
  if (listed.length) {
    graph.push({ "@type": "ItemList", name: "Вечерен обзор", itemListElement: listed });
  }
  // "<" is escaped so headline text can never close the script element
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/</g, "\\u003c");
  return `\n    <script type="application/ld+json">\n${json}\n    </script>\n    `;
}

// --- Main ---

function buildIndex() {
  const news = read("news/data/news.json");
  let top = null;
  try {
    top = read("news/data/top-news.json");
  } catch (_) {}

  const items = news.items
    .filter((i) => i.title && safeUrl(i.link) && Number.isFinite(Date.parse(i.pubDate)))
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  const national = items;

  const digest = renderDigest(top);

  let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  html = replaceBlock(html, "DIGEST", digest.html);
  html = replaceBlock(html, "FEED", renderTimeline(national));
  html = replaceBlock(html, "JSONLD", jsonLd(digest.stories, news.lastUpdated));
  fs.writeFileSync(path.join(ROOT, "index.html"), html);

  console.log(`index.html: ${national.length} headlines, ${digest.stories.length} digest stories`);
  return news.lastUpdated;
}

function writeSitemap({ lastUpdated, digests, blogUpdated }) {
  const pagesList = [
    { loc: "/", lastmod: lastUpdated, changefreq: "hourly", priority: "1.0" },
    { loc: "/obzor/", lastmod: digests[0]?.time, changefreq: "daily", priority: "0.8" },
    ...digests.map((d) => ({ loc: d.urlPath, lastmod: d.time, changefreq: "never", priority: "0.6" })),
    { loc: "/about/", changefreq: "monthly", priority: "0.4" },
    { loc: "/blog/", lastmod: blogUpdated, changefreq: "weekly", priority: "0.5" },
    { loc: "/politics/", changefreq: "yearly", priority: "0.2" },
    { loc: "/politics/pp/", changefreq: "yearly", priority: "0.2" },
    { loc: "/politics/progresivna-bulgaria/", changefreq: "yearly", priority: "0.2" },
    { loc: "/politics/gerb/", changefreq: "yearly", priority: "0.2" },
    { loc: "/stocks/", changefreq: "yearly", priority: "0.2" },
  ];
  const urls = pagesList
    .map((p) => `  <url>\n    <loc>${SITE}${p.loc}</loc>\n${p.lastmod ? `    <lastmod>${new Date(p.lastmod).toISOString()}</lastmod>\n` : ""}    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`)
    .join("\n");
  fs.writeFileSync(
    path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  fs.writeFileSync(
    path.join(ROOT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/news-sitemap.xml\n`,
  );
  console.log(`sitemap.xml (${pagesList.length} URLs) and robots.txt written`);
}

async function main() {
  const digests = pages.buildDigestArchive();
  pages.buildFeed(digests);
  pages.buildNewsSitemap(digests);
  const blogUpdated = await pages.buildBlog();
  const lastUpdated = buildIndex();
  writeSitemap({ lastUpdated, digests, blogUpdated });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
