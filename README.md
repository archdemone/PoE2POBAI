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

# poe2-mcp bridge (optional live game tools — DPS/eHP formulas, gem/passive/mod data, poe.ninja import)
POE2_MCP_COMMAND=py            # executable to launch poe2-mcp (default: `py` on Windows, else `python3`)
POE2_MCP_ARGS="-m src.mcp_server"  # args (default runs it as a module; the pip console script often isn't on PATH)
POE2_MCP_DISABLED=1            # set to skip the bridge entirely
# poe2-mcp requires SECRET_KEY and ENCRYPTION_KEY; if unset, random per-launch values are used.
```

### poe2-mcp bridge

`pip install poe2-mcp` adds ~32 live PoE2 tools (gem/support/passive/mod/base-item data,
mechanic explanations, poe.ninja character + URL import) that merge into the chat tool-use
loop alongside the local PoB tools. The server connects automatically on startup and runs fine
without it — check `GET /api/status` for `poe2Mcp.connected`. poe2-mcp follows a "data layer"
design: it supplies data and formulas; the LLM does the DPS/eHP math.

## Snapshot model

All builds are stored as immutable snapshots. Re-import from PoB2 to pick up changes. Direct mutation of a live PoB2 build is intentionally out of scope until the PoB2 Lua bridge is ready.

## What's next

1. PoB2 Lua bridge — live DPS/eHP calculations rather than XML-only stats.
2. ~~`poe2-mcp` integration~~ — **done**: connects on startup, merges ~32 live tools into the chat loop (see above).
3. Wire the web UI chat to USE MCP tools in a tool-use loop (Option B).
4. Snapshot clone/diff for safe what-if recommendations.
