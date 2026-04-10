# @jurislm/judicial-mcp

MCP (Model Context Protocol) server for [Taiwan Judicial Yuan](https://www.judicial.gov.tw) — provides 6 tools for accessing open data and judgments via natural language.

## Tools

### Authentication (1 tool)
- `auth_token` — Get authorization token (uses `JUDICIAL_USER` / `JUDICIAL_PASSWORD` env vars by default)

### Judgments (2 tools)
- `list_judgments` — Get judgment change list (requires token)
- `get_judgment` — Get judgment content by JID (requires token)

### Open Data (3 tools)
- `list_categories` — List topic categories
- `list_resources` — List data sources for a category (requires `categoryNo`)
- `download_file` — Download a data file with pagination support (requires `fileSetId`)

## Setup

### Environment Variables

```bash
JUDICIAL_USER=your_username
JUDICIAL_PASSWORD=your_password
```

### Usage with Claude Code (via bunx)

Add to your MCP configuration (`.mcp.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "judicial": {
      "command": "bunx",
      "args": ["@jurislm/judicial-mcp@latest"],
      "env": {
        "JUDICIAL_USER": "your_username",
        "JUDICIAL_PASSWORD": "your_password"
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
npm install
npm test           # Run tests
npm run lint       # oxlint
```

## License

MIT
