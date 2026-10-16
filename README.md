# @jurislm/judicial-mcp

MCP (Model Context Protocol) server for Taiwan's Judicial Yuan public judgments and open data, plus current regulations from the Ministry of Justice National Laws and Regulations Database. It provides 10 tools.

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

Each search result includes `case_id` (pass this as `caseId` to `fetch_judgment_text`), `case_number`, `date` (ISO date or `null`), `court`, `cause`, an optional `summary`, `source_url`, `search_source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, and `source_version`. The search response also includes `count`, `ambiguous`, `results`, `source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, `next_page`, and `source_version`. An `ambiguous` case-number search returns its candidates for you to choose from rather than selecting one.

The full-text response includes `case_id`, `date`, `full_text`, `source_url`, `retrieved_at`, `cache`, `truncated`, `partial`, and `source_version`. Text is capped at 40,000 characters; when that cap is reached, `truncated` and `partial` are `true`. `cache.status` is `not_cached`; `source_version` is `null` when the official source provides no version identifier.

Only an explicit no-matches response from the official site is returned as an empty result. Upstream denial or failure, an unrecognized page, or a missing judgment is returned as an MCP error (`isError: true`) with `error.code`, `error.message`, `error.source_url`, and `error.retrieved_at`.

## Regulation Lookup

`query_regulation` looks up one article by law name and article number in the Ministry of Justice's [National Laws and Regulations Database](https://law.moj.gov.tw/). It does not require credentials or an API token.

```json
{
  "lawName": "民法",
  "articleNumber": "1"
}
```

The tool resolves only a unique exact law-name match after normalizing whitespace and the common `台` / `臺` spelling. It returns candidates with `status: "ambiguous"` when the name does not resolve uniquely; it never chooses a fuzzy match. Article numbers use Arabic numerals and may include a hyphen, such as `1` or `1-1`.

Successful results include the regulation name and official identifier, one article's text, the official page URL, the lookup URL, retrieval time, and version metadata. The official page supplies consolidated current text; this tool does not provide historical versions. Amendment, promulgation, and effective dates are returned as ISO dates when the official page states them. Missing dates are `null` and mark the result `partial`; a pending or mixed effective date is identified in `version.effective_status`. `source_version` is the published amendment date, falling back to the promulgation date.

Responses cap article text at 30,000 characters. `truncated` and `partial` are `true` when text is capped or required version details are missing. `cache.status` is `miss`, `hit`, `refreshed`, `revalidated`, or `not_cached`. A process-local least-recently-used cache holds at most 100 exact law/article lookups for 15 minutes. Set `refresh: true` to bypass the cache. Expired entries are revalidated with official HTTP validators when available; if an upstream refresh fails, the tool returns an error and does not serve stale text as current.

Upstream failures and unrecognized page changes are MCP errors with `error.code`, `error.message`, `error.source_url`, and `error.retrieved_at`. Confirmed no-match, abolished-law, and missing-article responses have distinct codes.

## Tools

### Authentication (2 tools)
- `auth_token` — Get authorization token for judgment API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)
- `member_token` — Get member token for open data API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)

### Public Judgments (2 tools)
- `search_judgments` — Search public judgments without a token
- `fetch_judgment_text` — Get a judgment's full text by `case_id`, without a token

### Regulations (1 tool)
- `query_regulation` — Get one current regulation article and official version metadata, without a token

### Token-based Judgments (2 tools)
- `list_judgments` — Get the judgment change list (requires `auth_token`)
- `get_judgment` — Get judgment content by JID (requires `auth_token`)

### Open Data (3 tools)
- `list_categories` — List topic categories (requires `member_token`)
- `list_resources` — List data sources for a category (requires `member_token` + `categoryNo`)
- `download_file` — Download a data file with pagination support (requires `member_token` + `fileSetId`)

## Setup

### Environment Variables

The public judgment search tools do not require credentials. These variables are used only by the existing token-based judgment and open-data tools:

```bash
JUDICIAL_USER=your_username
JUDICIAL_PASSWORD=your_password
```

### Usage with Claude Code (via bunx)

Install Bun first, then add this stdio server to your MCP configuration (`.mcp.json` or `~/.claude/settings.json`). The public judgment and regulation tools work without setting credentials:

```json
{
  "mcpServers": {
    "judicial": {
      "command": "bunx",
      "args": ["@jurislm/judicial-mcp@latest"]
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
