# @jurislm/judicial-mcp

MCP (Model Context Protocol) server for [Taiwan Judicial Yuan](https://www.judicial.gov.tw) — provides 9 tools for searching public judgments and accessing open data.

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

### Planned: Statute Lookup (Phase 2)

Lookup by regulation name and article, with source links and bounded cache invalidation, is planned for phase 2 and is not available yet.

## Tools

### Authentication (2 tools)
- `auth_token` — Get authorization token for judgment API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)
- `member_token` — Get member token for open data API (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)

### Public Judgments (2 tools)
- `search_judgments` — Search public judgments without a token
- `fetch_judgment_text` — Get a judgment's full text by `case_id`, without a token

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

Install Bun first, then add this stdio server to your MCP configuration (`.mcp.json` or `~/.claude/settings.json`). The public judgment tools work without setting credentials:

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
