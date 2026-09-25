# Command reference

Every command prints one JSON document on stdout. `agenticseo --help` lists every command with its options.

Commands find the project from the current directory or any folder above it. Pass `--project DIR` to use another one.

## How results work

- **Costs.** Commands that call DataForSEO report `costUsd`, what DataForSEO charged. If a lookup was answered from the cache, it reports `cached: true` and costs nothing. How long a result stays cached is listed with each command.
- **Evidence.** Each paid result names an `evidence` file in `.agenticseo/evidence/` holding every row and the raw provider response. Command output is kept short enough for an agent to read; the evidence file has everything.
- **Missing data.** A metric the provider does not have is `null`, never 0.
- **Markets.** Research runs in the project's market. `--location US` (a country code, or a DataForSEO location code such as `2840`) and `--language en` run one call in another market. Changing only the location uses that country's main language.
- **Failures.** A failed command prints a message on stderr, followed by the provider's own response when there is one, and exits with one of these codes:

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected failure (a bug). stderr has the stack trace; please [report it](https://github.com/kid7st/agenticseo/issues). |
| 2 | Invalid input: arguments, no project, or an invalid `.agenticseo` file. The message names the field. |
| 3 | Missing or rejected credentials: a DataForSEO or Ahrefs key, or a Google grant that expired or was revoked. |
| 4 | The provider failed: network, HTTP error or unexpected response. A failure that was still charged includes the cost. |

- **Proxies.** Set `HTTPS_PROXY` (and `NO_PROXY` for exceptions) as you would for curl. Every request uses it, including Google and the audit crawler.

## Project

**`init --domain DOMAIN --location COUNTRY [--language CODE]`** creates `.agenticseo/project.json` for a site. The domain is stored bare (no `www`, scheme or path). An unsupported country and language pair is refused before anything is saved.

**`context`** checks and prints `.agenticseo/context.json`, what your agent knows about the business. You and your agent edit that file directly. It holds:
- `sections`: `business_overview`, `current_goal`, `positioning`, `writing_preferences`;
- `competitors`: domains with notes;
- `keyPages`: URLs with a role (`hub`, `spoke`, `money` or `other`), topic and notes;
- `customSections`;
- `researchLog`: dated findings, so an agent does not pay for the same research twice.

A missing file is an empty context. An invalid one fails with the exact field. The output adds `today` for new log entries (a future date is refused), shows the newest 20 log entries from the last 90 days, and lists report templates.

**`reports`** lists `.agenticseo/reports/*.md`. A report starts with a `# Title` line, followed by a short summary before its first section. An `.html` file with the same name is its shareable page. It must be self-contained, so it opens offline and prints cleanly: no scripts, remote stylesheets, fonts or images, and under 500 KB. Report templates live in `.agenticseo/templates/*.md` in the same shape.

**`overview [--refresh-backlinks]`** is the project dashboard in one result. It shows:
- rank trackers: keywords that improved or declined in the last week, and how many are in the top 10;
- the latest audit: its three worst issue types;
- the backlink snapshot, marked `stale` after a day;
- Search Console: the last 28 days against the 28 before;
- Google Analytics: organic sessions, users, engagement rate and key events against the previous period, with a daily trend.

Reading costs nothing. `--refresh-backlinks` buys a new backlink snapshot (about $0.02) when the current one is missing or over a day old.

**`query "SELECT ..."`** runs one read-only SQL statement against the project database and returns up to 500 rows. `SELECT name, sql FROM sqlite_schema` lists the tables: saved keywords and tags, keyword metrics, audits, pages, issues, Lighthouse results, and rank trackers, runs and snapshots.

## Keyword research

**`research "SEED"... [--limit 150|300|500] [--mode auto|related|suggestions|ideas] [--clickstream]`** finds keywords around 1–5 seed topics, each researched on its own.
- It starts with related keywords, then falls back to suggestions and ideas until at least five new keywords turn up. `--mode` fixes the source instead.
- Countries DataForSEO Labs does not cover use Google Ads keyword ideas. They have no difficulty or intent.
- It shows the first 25 rows for one seed, or 10 per seed in a batch. A seed that fails is reported with `ok: false` while the others succeed.
- Results are cached for 24 hours.

**`keywords TERM...`** returns search volume, CPC, competition, difficulty and intent for up to 700 terms. Terms with no data at all are listed in `missingKeywords`. `--clickstream` (also for `research`) refines search volume with clickstream data, at twice the cost, in Labs countries only.

**`serp "QUERY"... [--depth 10-100]`** fetches live Google results for 1–10 queries: every result type with its rank, title, URL, domain and description. Depth defaults to 20, and each extra 10 costs more. A batch shows 10 rows per query without descriptions; the evidence file keeps everything.

**`saved`** keeps a list of keywords for the project, with their latest metrics:
- `saved add KEYWORD... [--tags TAG,...] [--replace-tags]` saves keywords. Saving twice is harmless, and tags are added unless you pass `--replace-tags`.
- `saved list` shows them. Filter with `--search`, `--include`/`--exclude`, `--tags` (any of them), and volume, CPC and difficulty ranges; order with `--sort`/`--order`; page with `--page`.
- `saved tag ID... --add TAG --remove TAG`, `saved rename-tag TAG --to NAME [--color COLOR]` and `saved delete-tag TAG` manage tags. A tag still in use cannot be deleted.
- `saved remove ID...` deletes keywords.
- `saved export [--format csv|jsonl]` writes the list to `.agenticseo/exports/`. The CSV opens in Google Sheets or Excel.
- `saved refresh` fetches new metrics for every saved keyword (paid).

Keywords found by `research` or `keywords` keep their metrics, so saving them later needs no new lookup.

## Competitors and domains

Domain commands need a country DataForSEO Labs covers. Otherwise they exit 2 and ask you to choose one with `--location`.

A `TARGET` is a domain or URL. `--scope` narrows it: `subdomains` (the default for a domain), `domain` (without subdomains), `subfolder` (the default for a URL path) or `exact_url`.

**`domain TARGET`** estimates a domain's organic traffic and how many keywords it ranks for. Cached for 12 hours.

**`ranked TARGET`** lists the keywords a domain or page ranks for: position, volume, traffic, CPC, difficulty and URL.
- Filter with `--min-volume`, `--max-rank`, `--exclude TERM,...` (for example brand terms) and `--types` (result types).
- `--sort` orders by rank, volume, traffic or CPC; `--limit` (default 50) and `--offset` page through, with `totalCount` and `nextOffset` in the result.
- `ranked TARGET --sort traffic_estimate --limit 100` gives the keywords that bring a site the most traffic.

**`domain-keywords TARGET`** covers the same data with finer filters: `--include`/`--exclude` terms, `--search` (keyword or URL), and ranges for traffic, volume, CPC, difficulty and rank. `--sort traffic|volume|rank|score|cpc` (`score` is difficulty), `--page`/`--page-size`. DataForSEO accepts at most eight filter conditions per request. Cached for 12 hours.

**`pages TARGET`** lists a site's pages by organic traffic or number of ranking keywords, with URL-term, traffic and keyword-count filters. Cached for 12 hours.

**`competitors KEYWORD...`** finds the domains that rank across up to 100 keywords, sorted by visibility. `--exclude-domains` leaves out your own site.

**`backlinks overview TARGET`** summarizes a site's backlinks: rank, backlinks, referring domains, broken links and spam score, with 12 months of history and the top referring domains. Cached for six hours.
- `backlinks links`, `backlinks domains` and `backlinks pages` page through individual backlinks, referring domains and the site's most-linked pages.
- Each has filters and sort fields, such as `--link-type dofollow`, `--hide-lost` and `--min-domain-rank`; see `agenticseo --help`.
- Spammy referring domains (spam score above 40) are hidden unless you pass `--include-spam`.
- For a subfolder, rank, history and the referring-domain breakdown are not available.

**`domain-rating DOMAIN...`** looks up Ahrefs Domain Rating for up to 100 domains, cached for a day.
- It needs a free Ahrefs API key in `AHREFS_API_KEY`. Create a free Ahrefs account, then go to Account settings → API keys.
- A lookup that failed is listed under `failed`, never shown as "no rating".
- Credit "Domain Rating by Ahrefs" wherever you show the numbers.

## AI visibility

**`ai brand BRAND_OR_DOMAIN [--competitors A,B]`** shows how often AI answers mention a brand or domain in ChatGPT (US English only) and Google AI Overviews. It reports:
- mentions and AI search volume, with a monthly trend;
- the pages AI answers cite;
- example prompts;
- share of voice against up to five competitors.

It is the most expensive lookup: about $0.64 alone and $0.84 with two competitors in our tests. Cached for a day.

**`ai prompt "PROMPT" [--models chat_gpt,claude,gemini,perplexity] [--brand NAME]`** asks AI models one question with web search on. It shows the start of each answer, its citations and whether the brand appears. All four models cost about $0.15. Cached for a week, and the evidence file has the full answers.

## Local SEO

Identify a business with `--cid ID`, `--place-id ID` or `--name TEXT`. The cid and place_id come from `local businesses` or `local serp` rows and are the most reliable. Coordinates are `LAT,LNG`.

| Command | Result |
| --- | --- |
| `local businesses --near LAT,LNG --radius KM [--query TEXT]` | Listings nearby. Filters: `--categories`, `--min-rating`, `--min-reviews`, `--claimed`/`--unclaimed`. |
| `local serp "QUERY" --near LAT,LNG [--type maps\|local_finder]` | The Google Maps results for a search at a location |
| `local categories [TEXT]` | Business category names for `--categories` (free, cached a week) |
| `local profile BUSINESS` | One Google Business Profile: category, hours, rating breakdown |
| `local reviews BUSINESS [--sort newest] [--other-sources]` | Reviews, with owner replies |
| `local posts BUSINESS` | Posts published on the profile |
| `local questions BUSINESS --near LAT,LNG --radius KM` | Questions and answers on the profile |
| `local grid "QUERY" --center LAT,LNG BUSINESS [--size 3\|5]` | The business's Maps rank at each point of a grid around a location, with each point's #1 business |

A grid costs one Maps search per point: 9 for `--size 3`, 25 for `--size 5`.

Reviews and posts are charged when requested and collected for free. If they are not ready within about 20 seconds, the result has `status: "processing"` and a `taskId`. Run the same command with `--task-id ID` a minute later to collect them at no extra cost.

## Site audit

**`audit start [URL] [--max-pages N] [--lighthouse] [--wait]`** crawls your site, or URL, and records every page and issue. The crawl itself is free.
- It stays on the start URL's site, follows robots.txt and sitemaps, requests about one page per second, and backs off when the site asks it to slow down.
- `--max-pages` takes 10 to 10,000 (default 50).
- Addresses on your own machine or network, such as `localhost:3000`, need `--allow-private`.
- The audit runs in the background and the command returns its id at once. `--wait` runs it in the foreground instead.
- `--lighthouse` also runs Google Lighthouse on mobile and desktop through DataForSEO for a sample: the start page plus one page per URL pattern, up to 10 pages. Each check costs about $0.005.

After starting:
- `audit status [ID]` shows progress, issue counts once finished, and the worker's log file.
- An audit whose process stopped shows `interrupted`. `audit resume ID` continues it, or a failed one, without fetching saved pages or paying for stored Lighthouse checks again.
- `audit issues [ID] [--severity critical|warning|info] [--type TYPE]` lists issues, critical first, with how to fix each type.
- `audit pages [ID] [--status CODE] [--url-contains TEXT]` lists crawled pages.
- `audit lighthouse [ID]` lists each Lighthouse check's scores and Core Web Vitals. With `--result RESULT_ID [--category performance|accessibility|best-practices|seo]`, it lists one check's issues, biggest savings first.
- `audit export [ID] --table issues|pages|performance [--format csv|jsonl]` writes a table to `.agenticseo/exports/`.
- `audit export [ID] --table lighthouse --result RESULT_ID [--category CATEGORY | --full]` saves one Lighthouse check's issues, or its full result, as JSON.
- `audit list` shows every audit, and `audit delete ID` removes one (stopping it if it is running).

Commands without an id use the latest audit.

## Rank tracking

A tracker checks where your site ranks on Google for a set of keywords.

- **Create.** `rank create [DOMAIN]` makes a tracker for the project domain and market. The defaults are mobile, the top 40 results, and manual checks; change them with `--devices mobile|desktop|both`, `--depth 10-100` and `--schedule manual|daily|weekly|monthly`. Add `--location-name "Seattle,Washington,United States"` to track one city; `rank locations "Seattle"` finds the exact name (free).
- **Manage.** `rank add ID KEYWORD...` and `rank remove ID KEYWORD_ID...` change keywords (lowercased unless `--match-case`). `rank list`, `rank update ID` and `rank archive ID` manage trackers.
- **Check now.** `rank estimate ID` prices a check before you spend anything. `rank run ID` checks every keyword now and reports what it cost.
- **Read results.**
  - `rank show ID [--compare 1d|7d|30d|90d]`: each keyword's position, ranking URL and SERP features, against the start of the period.
  - `rank history ID KEYWORD_ID`: one keyword over time.
  - `rank trend ID`: how many keywords rank in the top 3, 4–10 and 11–20.
  - `rank matrix ID`: positions by date.
  - `rank metrics ID` refreshes search volume, difficulty and CPC (paid).
- **Schedule.** Trackers with a daily, weekly or monthly schedule are checked by `rank due`, which your system scheduler should run every hour. `rank schedule` prints the crontab line; add it yourself, and make `DATAFORSEO_API_KEY` available to the job.
  - The line pins the current Node binary, so print it again after upgrading Node.
  - Scheduled checks use DataForSEO's cheaper task queue (about 70% less than `rank run`) and take 5–15 minutes.
  - If a check is interrupted, the next `rank due` collects the results already paid for instead of paying again.

## Google Search Console and Analytics

These commands read your own Google data for free. They need a one-time [Google setup](google.md).

**Connecting**
- `google connect [--for search-console|analytics|all]` authorizes read-only access in your browser.
- `google accounts` lists connected accounts.
- `google disconnect EMAIL` revokes access at Google and forgets it.
- An expired or revoked grant exits 3 and names the command to reconnect.

**Search Console**
- `gsc sites` lists your properties, and `gsc use SITE_URL` picks one for the project, using the exact name, such as `sc-domain:example.com` or `https://www.example.com/`. `gsc disconnect` removes it.
- `gsc performance` returns clicks, impressions, CTR and position.
  - Group with `--dimensions query,page,country,device,date,searchAppearance`.
  - Choose dates with `--range last_28_days` (or `--start`/`--end`), and filter with `--filter DIMENSION:OPERATOR:EXPRESSION` (repeatable).
  - `--min-position`, `--max-position` and `--min-impressions` filter the top 1,000 rows. Page with `--start-row`.
- `gsc report` compares totals with the previous period and lists near-ranking queries (best page at positions 5–20) and countries.
- `gsc export [--dimension query|page]` writes the query or page table to `.agenticseo/exports/`.
- `gsc inspect URL...` runs URL Inspection on up to 10 URLs.

**Google Analytics**
- `ga4 properties` lists your properties, and `ga4 use PROPERTY_ID` picks one for the project. `ga4 disconnect` removes it.
- `ga4 report KIND` runs a report: `landing-pages`, `page-performance`, `key-events`, `traffic-acquisition`, `ecommerce`, `site-search` or `audience`.
  - Reports cover organic search unless you pass `--channel all`, and the last 28 complete days unless you pass `--start`/`--end`.
  - `--breakdown`, `--compare` (previous period) and `--include-date` apply where a report supports them. Page with `--limit`/`--offset`.
- `ga4 overview` compares organic totals with the previous period, with a daily or weekly trend.
- `ga4 health` checks tracking setup: data streams, enhanced measurement, key events and custom definitions.
- `ga4 opportunities` ranks landing pages by combining Search Console demand with Analytics engagement.

A metric Google withholds is `null`, never 0.
