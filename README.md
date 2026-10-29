# @jurislm/judicial-mcp

MCP (Model Context Protocol) server for Taiwan's Judicial Yuan public judgments and open data, plus latest promulgated regulations from the Ministry of Justice National Laws and Regulations Database. It provides 10 tools.

## Public Judgment Search

`search_judgments` searches the Judicial Yuan's public judgment website. `fetch_judgment_text` retrieves the full text for a result. Both tools use the public website and do not require an API token or Judicial Yuan account.

Search accepts any combination of these filters (at least one is required):

| Field | Meaning |
|-------|---------|
| `keyword` | Keyword in judgment text, up to 128 characters |
| `court` | Official court name or code, up to 80 characters |
| `year` | Decision year as a Gregorian or Minguo integer |
| `caseNumber` | Case number, either digits or a full form such as `113年度訴字第1234號` |
| `limit` | Results per page, 1–10; defaults to 5 |
| `page` | Official result page, 1–50; defaults to 1 |
| `offset` | Starting row within an official result page, 0–19; defaults to 0 |

Each search result includes `case_id` (pass this as `caseId` to `fetch_judgment_text`), `case_number`, `date` (ISO date or `null`), `court`, `cause`, an optional `summary`, `source_url`, `search_source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, and `source_version`. The search response also includes `count`, `ambiguous`, `results`, `source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, `next_page`, `next_offset`, and `source_version`. Follow both `next_page` and `next_offset` to retrieve every result; `next_offset` may point to another batch on the same official page. An `ambiguous` case-number search returns its candidates for you to choose from rather than selecting one.

The full-text response includes `case_id`, `date`, `full_text`, `source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, and `source_version`. Text is capped at 40,000 characters; when that cap is reached, `truncated` and `partial` are `true`. `cache.status` is `not_cached`; `source_version` is `null` when the official source provides no version identifier.

Only an explicit no-matches response from the official site is returned as an empty result. Upstream denial or failure, an unrecognized page, or a missing judgment is returned as an MCP error (`isError: true`) with `error.code`, `error.message`, `error.source_url`, and `error.retrieved_at`.

## Regulation Lookup

`query_regulation` looks up one article by law name and article number in the Ministry of Justice's [National Laws and Regulations Database](https://law.moj.gov.tw/). The official autocomplete lookup is tokenless. HTML pages are scraped only through a Firecrawl service configured with `FIRECRAWL_API_URL`; set `FIRECRAWL_API_KEY` when that service requires a key. If Firecrawl is unavailable, the tool returns a source error without a direct-HTTP HTML fallback.

```json
{
  "lawName": "民法",
  "articleNumber": "1"
}
```

The tool resolves only a unique exact law-name match after normalizing whitespace and the common `台` / `臺` spelling. It returns candidates with `status: "ambiguous"` when the name does not resolve uniquely; it never chooses a fuzzy match. Article numbers use Arabic numerals and may include a hyphen, such as `1` or `1-1`.

Successful results include the latest promulgated article text (`article_text_version: "latest_promulgated"`), official URLs, and law-level `version` metadata. Latest promulgated text can include amendments that have not taken effect. `status: "current"` identifies retrieval from the latest consolidated page, not a finding that the returned article is effective.

`article_effectiveness` separately evaluates the returned article version at `checked_at` (Taiwan date). Its `status` is `effective`, `not_yet_effective`, or `unknown`; `effective_date` is nullable. `reason` explains the decision and `basis` contains official source URLs and text excerpts. Decisions use the official law history and complete effective-status notes. Relative commencement dates and “effective from promulgation” clauses remain unknown unless the source provides an explicit supported calendar date. A current explicit pending notice can establish that the latest version is not yet effective without establishing its exact effective date. Unsupported conditions, partial-article commencement, conflicting or unavailable sources return `unknown`. An article absent from a pending warning is not presumed effective. A historical page containing the same text is not evidence of commencement. Pending latest text is not replaced with an unverified historical version; this tool does not supply a verified older effective text or decide which version applies to a case.

Law-level amendment, promulgation, and effective dates remain ISO dates or `null`. Missing dates keep `partial: true`, even when article-level commencement is verified. Law-level pending warnings do not establish that the queried article is pending. `source_version` remains the law amendment date, falling back to promulgation date.

Responses cap article text at 30,000 characters. `truncated` and `partial` are `true` when text is capped or required version details are missing. `cache.status` is `miss`, `hit`, `refreshed`, `revalidated`, or `not_cached`. A process-local least-recently-used cache holds at most 100 exact law/article lookups for 15 minutes. Set `refresh: true` to bypass the cache. Article decisions are revalidated across Taiwan midnight even before the 15-minute TTL expires. The additional official history request can increase latency; configure the MCP client with `tool_timeout_sec = 120`. Expired entries are looked up and scraped again through Firecrawl; if an upstream refresh fails, the tool returns an error and does not serve stale text as current.

Upstream failures and unrecognized page changes are MCP errors with `error.code`, `error.message`, `error.source_url`, and `error.retrieved_at`. Confirmed no-match, abolished-law, and missing-article responses have distinct codes.

## Tools

### Authentication (2 tools)
- `auth_token` — Get authorization token for judgment API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)
- `member_token` — Get member token for open data API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)

### Public Judgments (2 tools)
- `search_judgments` — Search public judgments without a token
- `fetch_judgment_text` — Get a judgment's full text by `case_id`, without a token

### Regulations (1 tool)
- `query_regulation` — Get one latest promulgated regulation article, its `article_effectiveness` result, and official version metadata, without a token

### Token-based Judgments (2 tools)
- `list_judgments` — Get the judgment change list (requires `auth_token`)
- `get_judgment` — Get judgment content by JID (requires `auth_token`)

### Open Data (3 tools)
- `list_categories` — List topic categories (requires `member_token`)
- `list_resources` — List data sources for a category (requires `member_token` + `categoryNo`)
- `download_file` — Download a data file with pagination support (requires `member_token` + `fileSetId`)

## Setup

### Environment Variables

The public judgment search tools do not require credentials. These variables are used by the existing token-based judgment and open-data tools:

```bash
JUDICIAL_USER=your_username
JUDICIAL_PASSWORD=your_password
```

Regulation lookup also needs a Firecrawl service base URL. The server appends `/v1/scrape` and sends raw-HTML scrape requests only for official Ministry of Justice pages. The key is read from the environment and is optional when Firecrawl is configured to allow keyless access. Use HTTPS when the configured service is remote; a key is sent over HTTP only to a loopback address.

```bash
FIRECRAWL_API_URL=https://your-firecrawl-host
FIRECRAWL_API_KEY=your_service_key
```

### Usage with Claude Code (via bunx)

Install Bun first, then add this stdio server to your MCP configuration (`.mcp.json` or `~/.claude/settings.json`). The public judgment tools work without credentials; regulation lookup needs the Firecrawl environment settings above:

```json
{
  "mcpServers": {
    "judicial": {
      "command": "bunx",
      "args": ["@jurislm/judicial-mcp@latest"],
      "env": {
        "FIRECRAWL_API_URL": "https://your-firecrawl-host",
        "FIRECRAWL_API_KEY": "your_service_key"
      }
    }
  }
}
```

### Usage with Claude Code Plugin (jurislm-tools)

If you use the [jurislm-tools](https://github.com/jurislm/jurislm-tools) Claude Code plugin, `jt:judicial` is included:

```
/plugin marketplace update jurislm-tools
```

Then set environment variables in `~/.zshenv`:

```bash
export JUDICIAL_USER=your_username
export JUDICIAL_PASSWORD=your_password
```

## Development

```bash
bun install --frozen-lockfile
bun run test
bun run lint
bun run typecheck
bun run build:types
```

## License

MIT
