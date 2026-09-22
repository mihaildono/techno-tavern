#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// ─── Minimal test harness for parseArticleDate ───────────
const SOURCE_TIMEZONE = "Europe/Sofia";

function parseArticleDate(pubDate) {
  if (!pubDate) return null;

  const raw = String(pubDate).trim();
  if (!raw) return null;

  // RFC 2822 with GMT
  if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) {
    return Date.parse(raw);
  }

  // ISO 8601 with Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) {
    return Date.parse(raw);
  }

  // ISO 8601 without timezone: treat as UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return Date.parse(raw + "Z");
  }

  // ISO 8601 with explicit offset: "+0000", "+0300"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/.test(raw)) {
    const normalized = raw.slice(0, -5) + ":" + raw.slice(-5);
    const t = Date.parse(normalized);
    if (Number.isFinite(t)) return t;
    return Date.parse(raw);
  }

  // YYYY-MM-DD HH:MM:SS — always store as UTC with Z suffix
  // Try UTC first; if the UTC timestamp is in the future,
  // the feed is publishing Sofia local time — shift to UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const match = raw.match(
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match;
    const utcTimestamp = Date.UTC(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second),
    );
    // If this UTC interpretation is in the future, the feed is likely
    // publishing Sofia local time. Fall back to the Sofia timezone.
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
      formatter
        .formatToParts(new Date(utcTimestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const shiftedTimestamp = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return utcTimestamp - (shiftedTimestamp - utcTimestamp);
  }

  return null;
}

// ─── Tests ────────────────────────────────────────────────

const tests = [
  {
    name: "Mediapool UTC time stays UTC",
    input: "2026-09-22 17:57:00",
    check: (ts) => {
      const hour = new Date(ts).getUTCHours();
      return hour === 17;
    },
    desc: "2026-09-22 17:57:00 should parse as UTC (17:57), not Sofia local (20:57)",
  },
  {
    name: "RFC 2822 with GMT",
    input: "Tue, 22 Sep 2026 17:51:42 GMT",
    check: (ts) => new Date(ts).toISOString().includes("2026-09-22T17:51:42"),
    desc: "RFC 2822 GMT timestamp should parse correctly",
  },
  {
    name: "ISO 8601 with Z",
    input: "2026-09-22T17:32:00Z",
    check: (ts) => new Date(ts).toISOString().includes("2026-09-22T17:32:00"),
    desc: "ISO 8601 Z timestamp should parse as UTC",
  },
  {
    name: "ISO 8601 without timezone",
    input: "2026-09-22T17:57:00",
    check: (ts) => new Date(ts).toISOString().includes("2026-09-22T17:57:00"),
    desc: "ISO 8601 without timezone should parse as UTC (17:57)",
  },
  {
    name: "Future Sofia local time gets shifted",
    input: "2099-09-22 17:57:00",
    check: (ts) => {
      const utcHour = new Date(ts).getUTCHours();
      return utcHour === 14;
    },
    desc: "Future YYYY-MM-DD HH:MM:SS should be treated as Sofia local (14:57 UTC)",
  },
  {
    name: "Space-separated date parses as UTC",
    input: "2026-09-22 21:07:00",
    check: (ts) => new Date(ts).toISOString().includes("2026-09-22T21:07:00"),
    desc: "Space-separated date should parse as UTC (21:07), not Sofia local (00:07+1day)",
  },
];

console.log("Running parseArticleDate tests...\n");
let passed = 0;
let failed = 0;

for (const t of tests) {
  const ts = parseArticleDate(t.input);
  if (ts === null) {
    console.log(`FAIL: ${t.name}`);
    console.log(`  Input: "${t.input}" → null (unparseable)`);
    console.log(`  ${t.desc}`);
    failed++;
    continue;
  }
  const ok = t.check(ts);
  if (ok) {
    console.log(`PASS: ${t.name}`);
    console.log(`  Input: "${t.input}" → ${new Date(ts).toISOString()}`);
    passed++;
  } else {
    console.log(`FAIL: ${t.name}`);
    console.log(`  Input: "${t.input}" → ${new Date(ts).toISOString()}`);
    console.log(`  ${t.desc}`);
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);