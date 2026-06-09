# ostrss — Östhammars kommun news as RSS

An **unofficial, community-generated** RSS/Atom feed for the news page of
Östhammars kommun ([osthammar.se/nyheter](https://www.osthammar.se/nyheter/)),
which publishes news as paginated HTML with no feed of its own.

> This project is **not** run by or affiliated with Östhammars kommun. Content
> is scraped from their public news page; the municipality is the source and
> copyright holder.

## Feeds

- RSS 2.0: `https://ivh.github.io/ostrss/feed.xml`
- Atom: `https://ivh.github.io/ostrss/atom.xml`

## How it works

A GitHub Actions cron job runs `src/scrape.js`, which fetches the news page,
parses the latest items with cheerio, and regenerates `public/feed.xml` (and
`atom.xml`) using the [`feed`](https://www.npmjs.com/package/feed) library. The
workflow commits the files only when they change, and GitHub Pages serves the
`public/` folder. Article URLs are used as stable `<guid>`s so readers aren't
re-notified when unrelated parts of the page change.

## Run locally

```bash
npm ci
node src/scrape.js
# open public/feed.xml
```

If the scrape returns zero items (markup changed, site down, non-200), the
script exits non-zero and **leaves the existing feed untouched** — an empty
feed would make some readers purge history.

## Validate

Check the output with the [W3C Feed Validator](https://validator.w3.org/feed/).
Paste the contents of `public/feed.xml`, or once published, validate by URL.

## If it breaks

The most likely cause is a **redesign of the source page** changing its DOM. The
parser is pinned to the semantic structure (an `<h3>` title link to
`/nyheter/...`, a `<small>` date, and a following `<p>` summary) in
`src/scrape.js` — update the selectors there if the layout changes. A failed run
shows up red in the Actions tab and does not overwrite the last good feed.

## Notes

- Cron is `*/30 * * * *`, but GitHub scheduled workflows are best-effort and can
  be delayed; the source only posts a few times a week, so this is plenty.
- Swedish dates (`8 juni 2026`) are parsed to proper RFC-822 `pubDate`s.
- GitHub Pages serves `.xml` with an XML content type; feed readers handle it
  fine.
