# Smashrun MCP Server

An MCP (Model Context Protocol) server that lets AI assistants retrieve a user's running data from [Smashrun](https://smashrun.com) via the [Smashrun API](https://api.smashrun.com/v1/documentation).

## Features

| Tool | Description |
| --- | --- |
| `get_user_info` | Profile and settings (units, heart rate config, follower counts, last run date) |
| `list_activities` | Paged run list; styles: `summary`, `briefs`, `ids`, `extended`; filter by `fromDateUTC` |
| `get_activity` | Full details of a single run by ID |
| `get_activity_notables` | Achievements for a run (e.g. fastest 5 km in 3 months) |
| `get_activity_splits` | Per-km or per-mile splits with speed and heart rate |
| `get_activity_tags` | Built-in and user-added tags for a run |
| `get_activity_polyline` | GPS route as `google` encoded polyline, `svg`, or `geojson` |
| `get_badges` | All badges the user has earned |
| `get_stats` | Aggregate stats: all-time, yearly, or monthly |
| `get_goals` | Yearly or monthly goals |
| `get_weight` | Body weight history or latest recording |

## Setup

### 1. Get a Smashrun access token

The easiest way (user-level auth, no API key registration needed):

1. Go to the [Smashrun API Explorer](https://api.smashrun.com/explorer).
2. Type `client` in the client id box at the top and click **connect**.
3. Sign in and authorize, then copy the access token.

Notes on user-level tokens:

- Rate limited to 250 requests/hour.
- Expire after ~60 days (re-authentication required, no refresh tokens).
- For a multi-user app, [request an API key](https://api.smashrun.com/register) instead.

### 2. Configure your MCP client

No install needed — the package is [on npm](https://www.npmjs.com/package/smashrun-mcp) and runs via `npx`.

Example config (Windsurf: `~/.codeium/windsurf/mcp_config.json`, Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "smashrun": {
      "command": "npx",
      "args": ["-y", "smashrun-mcp"],
      "env": {
        "SMASHRUN_ACCESS_TOKEN": "your-access-token-here"
      }
    }
  }
}
```

Restart your MCP client fully after editing the config.

<details>
<summary>Running from source instead</summary>

```sh
npm install
npm run build
```

Then point the config at the build output:

```json
{
  "mcpServers": {
    "smashrun": {
      "command": "node",
      "args": ["/absolute/path/to/smash-mcp/dist/index.js"],
      "env": {
        "SMASHRUN_ACCESS_TOKEN": "your-access-token-here"
      }
    }
  }
}
```

</details>

## Example prompts

- "What are my running stats for this year?"
- "List my last 10 runs and show the splits for the longest one."
- "What badges have I earned on Smashrun?"
- "Did I hit my monthly distance goal in June?"

## Development

```sh
npm run dev   # tsc --watch
npm start     # run the built server
```

The server communicates over stdio and reads the `SMASHRUN_ACCESS_TOKEN` environment variable.
