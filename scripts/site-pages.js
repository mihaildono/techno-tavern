// Static pages generated from the news data, used by scripts/build-pages.js:
//   /obzor/<YYYY-MM-DD>/  one permanent page per evening digest (NewsArticle)
//   /obzor/               archive index of all digests
//   /feed.xml             RSS feed of the digests
//   /news-sitemap.xml     Google News sitemap (digests from the last 2 days)
// Plus pre-rendering of the Mastodon posts into /blog/ for crawlers.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://www.technotavern.com";
const SOFIA = "Europe/Sofia";
const DIGESTS_DIR = path.join(ROOT, "news", "data", "digests");
const OG_IMAGE = `${SITE}/assets/og-image.jpg`;
const BRAND = "Techno Tavern";

// --- Helpers ---

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return String(text ?? "")
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

// Early digests stored timestamps without a zone; those were written in UTC.
function parseTime(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) raw += "Z";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

const isoDay = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: SOFIA }).format(date);
const longDay = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, day: "numeric", month: "long" });
const weekday = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, weekday: "long" });
const clock = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, hour: "2-digit", minute: "2-digit" });
const monthYear = new Intl.DateTimeFormat("bg-BG", { timeZone: SOFIA, month: "long", year: "numeric" });

// "21 октомври 2026 г." -> "21 октомври 2026"
const dayLabel = (date) => longDay.format(date).replace(/\s*г\.$/, "");

function truncate(text, max) {
  const clean = decode(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function writeFile(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function jsonLdScript(graph) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n    </script>`;
}

// --- Shared page chrome (same markup as the hand-written pages) ---

function page({ title, description, urlPath, ogType = "website", extraHead = "", jsonLd, mainClass = "news-page", body, robots }) {
  const url = `${SITE}${urlPath}`;
  return `<!doctype html>
<html lang="bg">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${robots || "index, follow, max-image-preview:large"}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#1c120d" />
    <link rel="alternate" type="application/rss+xml" title="Techno Tavern – вечерен обзор" href="${SITE}/feed.xml" />

    <meta property="og:type" content="${ogType}" />
    <meta property="og:locale" content="bg_BG" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Techno Tavern – новини от България и света, без реклами" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
${extraHead}
    ${jsonLdScript(jsonLd)}

    <link rel="icon" href="/assets/logo.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;500;600;700&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap" />
    <link rel="stylesheet" href="/style.css" />
    <link rel="stylesheet" href="/news/news.css" />
</head>

<body>
    <a class="skip-link" href="#main">Към съдържанието</a>

    <header class="masthead">
        <a class="brand" href="/">
            <img src="/assets/logo.svg" alt="" width="44" height="44" fetchpriority="high" />
            <span class="brand-name">Techno Tavern<span class="brand-place">Пловдив</span></span>
        </a>
        <nav class="primary-nav" aria-label="Основна навигация">
            <a href="/">Новини</a>
            <a href="/blog/">Блог</a>
            <a href="/about/">Как работи</a>
        </nav>
        <a class="support-link" href="https://revolut.me/mihailyhx" target="_blank" rel="noopener noreferrer"
            title="Подкрепи проекта в Revolut">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                    d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            <span>Подкрепи</span>
        </a>
    </header>

    <main id="main" class="${mainClass}">
${body}
    </main>

    <footer class="site-footer">
        <p class="footer-note">Независим новинарски поток от Пловдив. Без реклами, без проследяване.</p>
        <nav class="footer-group" aria-label="Проект">
            <h2>Проект</h2>
            <a href="/about/">Как работи</a>
            <a href="/blog/">Блог</a>
            <a href="/feed.xml">RSS</a>
            <a href="https://masto.bg/@Technotavern" rel="me noopener" target="_blank">Mastodon</a>
        </nav>
        <nav class="footer-group" aria-label="Архив">
            <h2>Архив</h2>
            <a href="/obzor/">Обзори</a>
            <a href="/politics/">Политика</a>
            <a href="/stocks/">Акции</a>
        </nav>
    </footer>
</body>

</html>
`;
}

const orgRef = { "@id": `${SITE}/#org` };

function breadcrumbs(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, urlPath], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE}${urlPath}`,
    })),
  };
}

function sourcesLine(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  return `<p class="story-sources"><span class="story-sources-label">Източници: </span>${esc(sources.join(", "))}</p>`;
}

// --- Digest archive ---

function loadDigests() {
  if (!fs.existsSync(DIGESTS_DIR)) return [];
  return fs
    .readdirSync(DIGESTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DIGESTS_DIR, f), "utf8"));
        const stories = (data.stories || []).filter((s) => s && s.headline);
        if (!stories.length) return null;
        const date = f.slice(0, 10);
        const time = parseTime(data.updatedAt) || new Date(`${date}T15:30:00Z`);
        return { date, time, overview: data.overview || "", stories, urlPath: `/obzor/${date}/` };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

function digestTitle(d) {
  return `Новините за ${dayLabel(d.time)}: ${d.stories[0].headline}`;
}

function renderDigestPage(d, newer, older) {
  const label = dayLabel(d.time);
  const description = truncate(d.overview || d.stories.map((s) => s.headline).join(". "), 155);

  const stories = d.stories
    .map((s, i) => {
      const href = safeUrl(s.link);
      const headline = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s.headline)}</a>`
        : esc(s.headline);
      const tag = i === 0 ? "h2" : "h3";
      const cls = i === 0 ? "lead-headline" : "digest-headline";
      const summaryCls = i === 0 ? "lead-summary" : "digest-summary";
      const inner = `<p class="story-category">${esc(s.category || "")}</p>
                <${tag} class="${cls}">${headline}</${tag}>
                <p class="${summaryCls}">${esc(s.summary || "")}</p>
                ${sourcesLine(s.sources)}`;
      return i === 0
        ? `<article class="lead">\n                ${inner}\n            </article>`
        : `<li class="digest-item">${inner}</li>`;
    });
  const [lead, ...rest] = stories;

  const nav = `<nav class="archive-nav" aria-label="Други обзори">
            ${older ? `<a rel="prev" href="${older.urlPath}">← ${esc(shortDay.format(older.time))}</a>` : "<span></span>"}
            <a href="/obzor/">Всички обзори</a>
            ${newer ? `<a rel="next" href="${newer.urlPath}">${esc(shortDay.format(newer.time))} →</a>` : "<span></span>"}
        </nav>`;

  const body = `        <section class="digest" aria-labelledby="page-title">
            <p class="digest-dateline"><span>Вечерен обзор</span> <time datetime="${d.time.toISOString()}">${esc(weekday.format(d.time))}, ${esc(label)}, ${clock.format(d.time)}</time></p>
            <h1 id="page-title" class="page-title">Новини от България и света за ${esc(label)}</h1>
            ${d.overview ? `<p class="digest-intro">${esc(d.overview)}</p>` : ""}
            ${lead}
            ${rest.length ? `<ol class="digest-rest" start="2">${rest.join("\n")}</ol>` : ""}
            <p class="digest-note">Обзорът е автоматично обобщение на заглавията от независими български и международни медии. Линковете водят към оригиналните статии.</p>
        </section>
        ${nav}`;

  const jsonLd = [
    {
      "@type": "NewsArticle",
      "@id": `${SITE}${d.urlPath}#article`,
      headline: truncate(digestTitle(d), 110),
      description,
      datePublished: d.time.toISOString(),
      dateModified: d.time.toISOString(),
      inLanguage: "bg",
      url: `${SITE}${d.urlPath}`,
      mainEntityOfPage: `${SITE}${d.urlPath}`,
      image: [OG_IMAGE],
      articleSection: "Вечерен обзор",
      keywords: [...new Set(d.stories.map((s) => s.category).filter(Boolean))].join(", "),
      author: orgRef,
      publisher: orgRef,
      isPartOf: { "@id": `${SITE}/#website` },
      citation: d.stories.map((s) => safeUrl(s.link)).filter(Boolean),
    },
    breadcrumbs([["Новини", "/"], ["Обзори", "/obzor/"], [label, d.urlPath]]),
  ];

  return page({
    title: `${truncate(`${label}: ${d.stories[0].headline}`, 70)} | ${BRAND}`,
    description,
    urlPath: d.urlPath,
    ogType: "article",
    extraHead: `    <meta property="article:published_time" content="${d.time.toISOString()}" />\n    <meta property="article:section" content="Вечерен обзор" />`,
    jsonLd,
    body,
  });
}

function renderArchiveIndex(digests) {
  const byMonth = new Map();
  for (const d of digests) {
    const key = monthYear.format(d.time).replace(/\s*г\.$/, "");
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(d);
  }
  const sections = [...byMonth.entries()]
    .map(([month, items]) => `            <section class="archive-month">
                <h2>${esc(month)}</h2>
                <ol class="archive-list">
${items
  .map(
    (d) => `                    <li><a href="${d.urlPath}"><time datetime="${d.date}">${esc(shortDay.format(d.time))}</time><span>${esc(d.stories[0].headline)}</span></a></li>`,
  )
  .join("\n")}
                </ol>
            </section>`)
    .join("\n");

  const body = `        <div class="page-head">
            <h1 class="page-title">Архив на вечерните обзори</h1>
            <p class="digest-intro">Всяка вечер обобщаваме петте водещи теми от България и света. Тук са всички обзори по дати. Можете да ги следите и чрез <a href="/feed.xml">RSS</a>.</p>
        </div>
${sections || '            <p class="digest-intro">Все още няма архивирани обзори.</p>'}`;

  const jsonLd = [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/obzor/#page`,
      url: `${SITE}/obzor/`,
      name: "Архив на вечерните обзори",
      inLanguage: "bg",
      isPartOf: { "@id": `${SITE}/#website` },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: digests.slice(0, 50).map((d, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE}${d.urlPath}`,
          name: digestTitle(d),
        })),
      },
    },
    breadcrumbs([["Новини", "/"], ["Обзори", "/obzor/"]]),
  ];

  return page({
    title: `Архив на новините от България и света | ${BRAND}`,
    description: "Архив на вечерните обзори на Techno Tavern: петте водещи новини от България и света за всеки ден, с линкове към оригиналните статии.",
    urlPath: "/obzor/",
    jsonLd,
    body,
  });
}

function buildDigestArchive() {
  const digests = loadDigests();
  digests.forEach((d, i) => {
    writeFile(`obzor/${d.date}/index.html`, renderDigestPage(d, digests[i - 1], digests[i + 1]));
  });
  writeFile("obzor/index.html", renderArchiveIndex(digests));
  console.log(`obzor/: ${digests.length} digest pages`);
  return digests;
}

// --- RSS feed of the digests ---

function buildFeed(digests) {
  const items = digests.slice(0, 30).map((d) => {
    const html = `<p>${esc(d.overview)}</p><ol>${d.stories
      .map((s) => `<li><strong>${esc(s.headline)}</strong> — ${esc(s.summary || "")}</li>`)
      .join("")}</ol>`;
    return `    <item>
      <title>${esc(digestTitle(d))}</title>
      <link>${SITE}${d.urlPath}</link>
      <guid isPermaLink="true">${SITE}${d.urlPath}</guid>
      <pubDate>${d.time.toUTCString()}</pubDate>
      <description>${esc(html)}</description>
    </item>`;
  });
  writeFile(
    "feed.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Techno Tavern – новини от България и света</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Вечерен обзор на петте водещи новини от България и света, без реклами.</description>
    <language>bg</language>
${digests[0] ? `    <lastBuildDate>${digests[0].time.toUTCString()}</lastBuildDate>\n` : ""}${items.join("\n")}
  </channel>
</rss>
`,
  );
  console.log(`feed.xml: ${items.length} items`);
}

// --- Google News sitemap (only articles from the last 48 hours qualify) ---

function buildNewsSitemap(digests) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = digests.filter((d) => d.time.getTime() >= cutoff);
  const urls = recent
    .map(
      (d) => `  <url>
    <loc>${SITE}${d.urlPath}</loc>
    <news:news>
      <news:publication>
        <news:name>${BRAND}</news:name>
        <news:language>bg</news:language>
      </news:publication>
      <news:publication_date>${d.time.toISOString()}</news:publication_date>
      <news:title>${esc(digestTitle(d))}</news:title>
    </news:news>
  </url>`,
    )
    .join("\n");
  writeFile(
    "news-sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>
`,
  );
  console.log(`news-sitemap.xml: ${recent.length} recent digest(s)`);
}

// --- Blog pre-render (Mastodon) ---

const MASTODON_STATUSES =
  "https://masto.bg/api/v1/accounts/115955044932859142/statuses?limit=10&exclude_replies=true";

// Mastodon already sanitises post HTML; strip anything executable anyway
// because it is written verbatim into our page.
function cleanPostHtml(html) {
  return String(html || "")
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2")
    .replace(/<a[^>]*class="[^"]*mention hashtag[^"]*"[^>]*>(.*?)<\/a>/g, '<span class="hashtag">$1</span>');
}

async function buildBlog() {
  const file = path.join(ROOT, "blog", "index.html");
  let html = fs.readFileSync(file, "utf8");
  const start = "<!--POSTS:start-->";
  const end = "<!--POSTS:end-->";
  if (!html.includes(start) || !html.includes(end)) {
    console.warn("blog/: POSTS markers missing, skipped");
    return null;
  }
  let posts;
  try {
    const res = await fetch(MASTODON_STATUSES, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    posts = await res.json();
    if (!Array.isArray(posts)) throw new Error("unexpected response");
  } catch (error) {
    // Keep whatever was rendered last time
    console.warn(`blog/: Mastodon not reachable (${error.message}), kept previous posts`);
    return null;
  }
  const rendered = posts
    .filter((p) => p && p.content && p.url)
    .map((p) => {
      const date = parseTime(p.created_at) || new Date();
      return `<article class="blog-post"><a class="post-date" href="${esc(safeUrl(p.url) || "#")}" target="_blank" rel="noopener noreferrer"><time datetime="${date.toISOString()}">${esc(dayLabel(date))}</time></a><div class="post-content">${cleanPostHtml(p.content)}</div></article>`;
    })
    .join("\n");
  html = html.slice(0, html.indexOf(start) + start.length) + rendered + html.slice(html.indexOf(end));
  fs.writeFileSync(file, html);
  const latest = posts[0] && parseTime(posts[0].created_at);
  console.log(`blog/: ${posts.length} posts pre-rendered`);
  return latest ? latest.toISOString() : null;
}

module.exports = {
  buildDigestArchive,
  buildFeed,
  buildNewsSitemap,
  buildBlog,
  isoDay,
  parseTime,
};
