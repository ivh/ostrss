import * as cheerio from "cheerio";
import { Feed } from "feed";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// GitHub Pages (branch source) can only serve the repo root or /docs, so the
// generated feed lives in docs/ rather than a public/ folder.
const OUT_DIR = join(__dirname, "..", "docs");

const SITE = "https://www.osthammar.se";
const NEWS_URL = `${SITE}/nyheter/`;
const PAGES_BASE = "https://ivh.github.io/ostrss";
const REPO_URL = "https://github.com/ivh/ostrss";
const USER_AGENT = `osthammar-rss-bot/1.0 (+${REPO_URL})`;
const MAX_ITEMS = 30;

const MONTHS = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

// "8 juni 2026" -> Date at 12:00 UTC (noon avoids any timezone date-shift).
function parseSwedishDate(text) {
  const m = text.toLowerCase().match(/(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  return new Date(Date.UTC(Number(m[3]), month - 1, Number(m[1]), 12, 0, 0));
}

function squish(s) {
  return s.replace(/\s+/g, " ").trim();
}

async function scrape() {
  const res = await fetch(NEWS_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();

  // Each news item: <h3> containing the title <a href=".../nyheter/...">,
  // a <small> sub-heading with the Swedish date, and a following <p> summary
  // whose trailing <small> holds the "Läs mer" link. Pinned to this semantic
  // shape rather than a deep CSS path so a restyle is less likely to break it.
  $("h3").each((_, h3) => {
    const $h3 = $(h3);
    const $a = $h3.find("a[href]").first();
    const href = ($a.attr("href") || "").trim();
    const title = squish($a.text());
    if (!href || !title) return;

    const url = new URL(href, SITE).href;
    if (!url.includes("/nyheter/")) return;
    if (url.replace(/\/$/, "") === NEWS_URL.replace(/\/$/, "")) return; // skip the listing link
    if (seen.has(url)) return;
    seen.add(url);

    const dateText = squish($h3.find("small").first().text());
    const date = parseSwedishDate(dateText);
    if (!date) {
      console.warn(`WARN: could not parse date "${dateText}" for ${url}; falling back to now.`);
    }

    const $p = $h3.nextAll("p").first().clone();
    $p.find("small").remove(); // drop the trailing "Läs mer" link
    const summary = squish($p.text());

    items.push({ title, url, date: date || new Date(), summary });
  });

  return items;
}

function buildFeed(items) {
  // Derive the feed's "updated" timestamp from the newest item rather than the
  // wall clock, so identical content produces an identical file run-to-run and
  // the CI commit-on-change guard doesn't fire every 30 minutes.
  const updated = items.reduce(
    (max, it) => (it.date > max ? it.date : max),
    items[0].date,
  );
  const disclaimer =
    "Inofficiellt RSS-flöde för nyheter från Östhammars kommun (osthammar.se). " +
    "Detta flöde är community-genererat och drivs inte av kommunen.";

  const feed = new Feed({
    title: "Östhammars kommun – Nyheter",
    description: disclaimer,
    id: NEWS_URL,
    link: NEWS_URL,
    language: "sv",
    updated,
    generator: `ostrss (${REPO_URL})`,
    copyright: "Innehåll © Östhammars kommun. Inofficiellt flöde genererat av ostrss.",
    feedLinks: {
      rss: `${PAGES_BASE}/feed.xml`,
      atom: `${PAGES_BASE}/atom.xml`,
    },
    author: { name: "ostrss (inofficiellt)", link: REPO_URL },
  });

  for (const it of items.slice(0, MAX_ITEMS)) {
    feed.addItem({
      title: it.title,
      id: it.url, // -> <guid> with no isPermaLink attr => spec default isPermaLink="true"
      link: it.url,
      description: it.summary,
      date: it.date,
    });
  }

  return feed;
}

async function main() {
  let items;
  try {
    items = await scrape();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    console.error("Leaving existing feed intact, exiting non-zero.");
    process.exit(1);
  }

  // Last-good-feed guard: never overwrite a populated feed with an empty one.
  if (items.length === 0) {
    console.error("ERROR: parsed zero items (markup change or site issue?).");
    console.error("Leaving existing feed intact, exiting non-zero.");
    process.exit(1);
  }

  const feed = buildFeed(items);
  writeFileSync(join(OUT_DIR, "feed.xml"), feed.rss2(), "utf-8");
  writeFileSync(join(OUT_DIR, "atom.xml"), feed.atom1(), "utf-8");
  console.log(`Wrote ${Math.min(items.length, MAX_ITEMS)} of ${items.length} items to docs/feed.xml and docs/atom.xml`);
}

main();
