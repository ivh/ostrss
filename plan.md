# Plan: Scraper → RSS feed for Östhammars kommun news

## Goal
Build a small scraper that turns the Östhammars kommun news page into a valid RSS 2.0 feed, runs on a schedule via GitHub Actions, commits the generated `feed.xml` to the repo, and serves it via GitHub Pages.

The municipality (`https://www.osthammar.se/nyheter/`) publishes news as paginated HTML with no RSS feed. This project generates one.

## Stack
- **Language:** Node.js (LTS, e.g. 20 or 22). Use ESM (`"type": "module"`).
- **Scrape/parse:** `node-fetch` is unnecessary on Node 20+ (global `fetch` exists). Use `cheerio` for HTML parsing.
- **RSS generation:** `feed` package (handles RSS 2.0 + Atom, escaping, RFC-822 dates) OR build the XML by hand with a tiny template. Prefer the `feed` package for correctness.
- **Schedule + host:** GitHub Actions (cron) generates the file and commits it; GitHub Pages serves it.
- No database. State lives in the committed `feed.xml` and the source site.

## Repo layout
```
.
├── src/
│   └── scrape.js          # main entry: fetch → parse → write public/feed.xml
├── public/
│   └── feed.xml           # generated output, committed, served by Pages
├── .github/
│   └── workflows/
│       └── build-feed.yml # cron + commit workflow
├── package.json
└── README.md
```

## Source page structure (already verified — build selectors against this)
The page at `https://www.osthammar.se/nyheter/` lists news items. Each item is structured as:
- An `<h3>` containing an `<a>` whose **href is the article URL** and whose text is the **title**.
- The publication **date** appears as text immediately after the link, in Swedish format like `8 juni 2026`.
- A **summary** paragraph follows, ending with a "Läs mer" link.

Example item shape (titles/dates real, as of build time):
- Title: "VA-programmet möjliggör för mer dricksvatten"
- URL: `https://www.osthammar.se/nyheter/2026/va-programmet-mojliggor-for-mer-dricksvatten/`
- Date: `8 juni 2026`
- Summary: paragraph of text, strip the trailing "Läs mer".

**Pin selectors to the semantic structure (h3 > a, following date text, following summary), not deep/brittle CSS paths.** Inspect the live page first and confirm the exact DOM before finalizing selectors — the redesign risk is real, so write the parser defensively.

## Parsing requirements

### 1. Swedish date → RFC-822
Dates render as `D MMMM YYYY` in Swedish. Map month names to numbers:
```
januari=1, februari=2, mars=3, april=4, maj=5, juni=6,
juli=7, augusti=8, september=9, oktober=10, november=11, december=12
```
Parse to a `Date` (use 12:00 local/UTC noon to avoid timezone date-shift), and let the `feed` package emit a proper `pubDate`. If a date fails to parse, fall back to "now" but log a warning — do not crash.

### 2. Stable GUIDs
Use the **article URL** as the RSS `<guid>` (isPermaLink=true). The site uses stable slug-based URLs. Never hash content or use list position — that re-notifies readers on every change.

### 3. Absolute URLs
Resolve any relative hrefs against `https://www.osthammar.se/` so links work in readers.

## Robustness requirements (do not skip these)

- **Last-good-feed fallback:** If the scrape yields **zero items** (markup changed, site down, non-200 response), do **not** overwrite `public/feed.xml` with an empty feed. Exit non-zero (so the workflow run is visibly red) and leave the previous file intact. Empty feeds make some readers purge history.
- **Polite fetching:** Send a descriptive `User-Agent` (e.g. `osthammar-rss-bot/1.0 (+https://github.com/<user>/<repo>)`). One request per run. The cron interval is generous on purpose (see workflow).
- **Item cap:** Keep the most recent ~20–30 items in the feed. The source has 700+; don't serialize all of them.
- **Validate output:** After generation, the XML should pass the W3C Feed Validator. Include a note in README on how to check.
- **Encoding:** Page is UTF-8 with Swedish characters (å, ä, ö). Ensure fetch decodes as UTF-8 and the `feed` library emits UTF-8 — verify åäö survive end-to-end.

## Feed metadata
- title: `Östhammars kommun – Nyheter`
- description: `Inofficiellt RSS-flöde för nyheter från Östhammars kommun (osthammar.se)`
- link / site URL: `https://www.osthammar.se/nyheter/`
- feed self-link: the GitHub Pages URL (`https://<user>.github.io/<repo>/feed.xml`)
- language: `sv`
- Include an explicit note in the description that this is an **unofficial, community-generated** feed, not run by the municipality.

## GitHub Actions workflow (`build-feed.yml`)
- **Trigger:** `schedule` cron + `workflow_dispatch` (manual run button).
- **Cron interval:** every 30 minutes is plenty (`*/30 * * * *`); the source posts a few times a week. Note in README that GitHub cron is best-effort and can be delayed.
- **Steps:**
  1. checkout
  2. setup-node (cache npm)
  3. `npm ci`
  4. `node src/scrape.js`
  5. Commit `public/feed.xml` only if it changed (use a guard: `git diff --quiet || (git add public/feed.xml && git commit -m "update feed" && git push)`). Use `stefanzweifel/git-auto-commit-action` or a manual git block — either is fine; avoid committing on no-change to keep history clean.
- **Permissions:** `contents: write` so the workflow can push.
- If the scrape script exits non-zero (zero-items guard), the run goes red and nothing is committed — that's the desired behavior.

## GitHub Pages
- Serve from the `public/` folder (configure Pages source as the relevant branch + `/public`, or move output to a `docs/`-style setup if simpler).
- Final feed URL: `https://<user>.github.io/<repo>/feed.xml`.
- Confirm Pages serves `.xml` with a sensible content type; readers are tolerant, but note it in README.

## README.md should include
- What this is + the unofficial disclaimer.
- The feed URL.
- How it works (cron → scrape → commit → Pages) in 3 sentences.
- How to run locally (`npm ci && node src/scrape.js`, then open `public/feed.xml`).
- How to validate (W3C Feed Validator link).
- A "if it breaks" note: the most likely cause is a redesign of the source page changing the DOM; fix selectors in `src/scrape.js`.

## Acceptance criteria
1. `node src/scrape.js` run locally produces a valid `public/feed.xml` with the latest items, correct titles, absolute links, parsed dates, and intact Swedish characters.
2. Re-running with the site unreachable / zero items does **not** clobber the existing feed and exits non-zero.
3. The Actions workflow runs on schedule, commits only on change, and the file is reachable at the Pages URL.
4. The feed passes the W3C Feed Validator.

## Out of scope (for v1)
- Multiple municipalities / multiple feeds.
- Full article body fetching (summary from the list page is enough).
- Per-category or per-year feeds (the `?year=` / `?month=` filters exist but v1 is the default latest list).

## Stretch (optional, only if trivial)
- Emit an Atom feed alongside RSS (`feed` package gives both for free).
- A tiny `index.html` on Pages linking to the feed with the disclaimer.
