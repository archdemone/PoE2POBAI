# PoBAI

PoBAI gives an LLM full tool-based access to Path of Building 2 builds via the Model Context Protocol (MCP). The LLM can import builds, inspect skills, items, defenses, and the passive tree — then use that grounded data to give real build advice.

## Architecture

```
LLM (Claude Desktop / any MCP client)
        │
        │ MCP stdio
        ▼
apps/pob-mcp-server   ← the product: 13 MCP tools for PoB2 build access
        │
        │ shared disk store (data/snapshots/)
        ▼
apps/pobai-server     ← HTTP server for the web UI companion
apps/pobai-web        ← React UI for human-facing snapshot + chat view
```

## MCP server (primary)

`apps/pob-mcp-server` exposes 13 tools over stdio MCP:

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
| `pob2_get_calcs` | Read live calculated stats from PoB2 via the optional Lua bridge. |
| `pob2_export_build` | Export the current live PoB2 build XML and calculated stats. |
| `pob2_test_gem_swap` | Import a full modified build XML and return recalculated stats. |
| `pob2_test_item_swap` | Import a full modified build XML and return recalculated stats. |
| `pob2_test_passive_change` | Import a full modified build XML and return recalculated stats. |

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

The MCP-server tests cover XML parsing, PoB code decompression, item/skill/defense extraction, snapshot CRUD, bridge handoff contracts, and disk persistence.

## Web UI companion (optional)

The web UI lets you paste builds, chat through the REST `/api/chat` tool-use loop, and compare two imported builds side by side. The compare panel is meant for copying a guide build: pick "My build" and "Build to copy", then review stat deltas, skill/item changes, and passive differences. Positive stat deltas render green and negative deltas render red. It shares the same `data/snapshots/` store as the MCP server.

### One-click local launch

On Windows, double-click `start.bat` or run:

```bash
start.bat
```

This builds the website, starts the HTTP server, opens `http://localhost:3001`, and tries to launch Path of Building 2 if it can find it. If PoB2 is not detected, configure one of these before launching:

```bat
set POB2_EXE=C:\PathOfBuilding2\Path of Building.exe
set POB2_DIR=C:\PathOfBuilding2
start.bat
```

You can also pass paths directly:

```bash
start.bat --pob-exe "C:\PathOfBuilding2\Path of Building.exe"
start.bat --pob2-dir "C:\PathOfBuilding2" --install-bridge
```

`--install-bridge` is opt-in because it patches PoB2 files. Use `--bridge-dry-run` first to see what would change.

The same launcher works through npm:

```bash
npm run launch
```

```bash
npm run dev   # Vite @ 5173, HTTP server @ 3001
```

## Environment variables

```bash
POBAI_SERVER_PORT=3001
POBAI_DATA_DIR=/path/to/data/snapshots   # shared between MCP server and HTTP server
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
POB2_EXE=C:\PathOfBuilding2\Path of Building.exe
POB2_DIR=C:\PathOfBuilding2

# poe2-mcp bridge (optional live game tools — DPS/eHP formulas, gem/passive/mod data, poe.ninja import)
POE2_MCP_COMMAND=py            # executable to launch poe2-mcp (default: `py` on Windows, else `python3`)
POE2_MCP_ARGS="-m src.mcp_server"  # args (default runs it as a module; the pip console script often isn't on PATH)
POE2_MCP_DISABLED=1            # set to skip the bridge entirely
# poe2-mcp trade-auth features can use SECRET_KEY and ENCRYPTION_KEY if you set them.
```

### poe2-mcp bridge

`pip install poe2-mcp` adds ~32 live PoE2 tools (gem/support/passive/mod/base-item data,
mechanic explanations, poe.ninja character + URL import) that merge into the chat tool-use
loop alongside the local PoB tools. The server connects automatically on startup and runs fine
without it — check `GET /api/status` for `poe2Mcp.connected`. poe2-mcp follows a "data layer"
design: it supplies data and formulas; the LLM does the DPS/eHP math.

## Snapshot model

Imported builds are stored as immutable snapshots. Re-import from PoB2 to pick up changes. The optional PoB2 Lua bridge is experimental and can mutate the live PoB2 build when testing full modified build XML; export the current build first so it can be restored.

## What's next

1. Validate `pobai_bridge.lua` against a real PoB2 runtime, especially LuaSocket/dkjson availability and calc-module access.
2. Make what-if bridge tests reversible so PoBAI restores the user's original live build after each experiment.
3. Add API-key/model settings to the web UI for live OpenRouter chat instead of local demo mode only.

The guided 3-step build compare (load both → see differences → swap checklist) now covers
per-gem level/quality diffs, per-item affix diffs, a "close enough" tolerance that renders
near-identical stats white instead of green/red, and named passive nodes with their stats
(keystones/notables/masteries) for added/removed tree nodes.

### Passive tree data

The compare view resolves passive node ids to names + stats from compact indexes under
`data/tree/<version>.json`, generated from Path of Building 2's bundled `TreeData`. They're
checked in so compare works offline. Regenerate them after a PoB2 tree update:

```bash
npm run tree:build                       # auto-detects the PoB2 install
npm run tree:build -- --pob2-dir "C:\PathOfBuilding2"
```
