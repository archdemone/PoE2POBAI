# PoBAI

PoBAI gives an LLM full tool-based access to Path of Building 2 builds via the Model Context Protocol (MCP). The LLM can import builds, inspect skills, items, defenses, and the passive tree — then use that grounded data to give real build advice.

## Architecture

```
LLM (Claude Desktop / any MCP client)
        │
        │ MCP stdio
        ▼
apps/pob-mcp-server   ← the product: 8 MCP tools for PoB2 build access
        │
        │ shared disk store (data/snapshots/)
        ▼
apps/pobai-server     ← HTTP server for the web UI companion
apps/pobai-web        ← React UI for human-facing snapshot + chat view
```

## MCP server (primary)

`apps/pob-mcp-server` exposes 8 tools over stdio MCP:

| Tool | What it does |
|---|---|
| `import_pob_build` | Import a PoB export code (base64) or raw XML. Returns `snapshot_id`. |
| `list_builds` | List all imported builds. |
| `get_build_summary` | Full build data: character, skills, items, defenses, passive tree. |
| `get_skills` | All skill groups and gem details. |
| `get_items` | Equipped items, optionally filtered by slot. |
| `get_passive_tree` | Tree URL, version, allocated node count. |
| `get_defenses` | Life, ES, resistances, armour, evasion, block. |
| `delete_build` | Remove a stored build. |

### Claude Desktop setup

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pob-assistant": {
      "command": "node",
      "args": ["/absolute/path/to/PoE2POBAI/apps/pob-mcp-server/dist/index.js"]
    }
  }
}
```

Then build once:
```bash
npm install
npm run build --workspace apps/pob-mcp-server
```

### Dev / run without build

```bash
npm install
npx tsx apps/pob-mcp-server/src/index.ts
```

### Tests

```bash
npm run test --workspace apps/pob-mcp-server
```

34 tests covering: XML parsing, PoB code decompression, item/skill/defense extraction, snapshot CRUD, and disk persistence.

## Web UI companion (optional)

The web UI lets you paste builds and chat with an LLM manually. It shares the same `data/snapshots/` store as the MCP server.

```bash
npm run dev   # Vite @ 5173, HTTP server @ 3001
```

## Environment variables

```bash
POBAI_SERVER_PORT=3001
POBAI_DATA_DIR=/path/to/data/snapshots   # shared between MCP server and HTTP server
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

## Snapshot model

All builds are stored as immutable snapshots. Re-import from PoB2 to pick up changes. Direct mutation of a live PoB2 build is intentionally out of scope until the PoB2 Lua bridge is ready.

## What's next

1. PoB2 Lua bridge — live DPS/eHP calculations rather than XML-only stats.
2. `poe2-mcp` integration — character data, support validation, top-build comparison.
3. Wire the web UI chat to USE MCP tools in a tool-use loop (Option B).
4. Snapshot clone/diff for safe what-if recommendations.
