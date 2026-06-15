# PoB2 → PoBAI integration

Two stages: **export helper now** (works immediately, no PoB2 modification), **in-app chatbox later** (requires patching PoB2 Lua).

---

## Stage 1 — Export helper (current)

`export.mjs` reads your saved PoB2 build files from disk, sends the selected one to PoBAI, and opens the browser.

**Requirements:** Node.js ≥ 22. No `npm install` needed.

### Run it

```bash
# From the repo root:
node integrations/pob2-addon/export.mjs
```

The script auto-detects your PoB2 saves directory. If detection fails, pass the path explicitly:

```bash
# Windows
node integrations/pob2-addon/export.mjs --builds-dir "%APPDATA%\PathOfBuilding2\Builds"

# macOS
node integrations/pob2-addon/export.mjs --builds-dir "~/Library/Application Support/PathOfBuilding2/Builds"

# Linux
node integrations/pob2-addon/export.mjs --builds-dir "~/.local/share/PathOfBuilding2/Builds"
```

### Optional flags

| Flag | Default | Description |
|---|---|---|
| `--builds-dir` | auto-detected | Path to PoB2 Builds directory |
| `--server` | `http://localhost:3001` | PoBAI API server URL |
| `--ui` | `http://localhost:5173` | PoBAI web UI URL |
| `--label` | filename | Override the snapshot label |
| `--pick N` | interactive | Non-interactive: select build N without prompting |

### Example session

```
PoBAI — Path of Building 2 export tool
─────────────────────────────────────────────
Builds dir : C:\Users\you\AppData\Roaming\PathOfBuilding2\Builds
Server     : http://localhost:3001
UI         : http://localhost:5173

   1. TwisterDeadeye                     Ranger / Deadeye  lvl 82  "Smokewraith"
   2. FireballSorceress                  Sorceress  lvl 67
   3. TestBuild                          (unrecognised build format)

Select build number (or Enter to cancel): 1

Importing "TwisterDeadeye" …
✓ Imported — snapshot a3f92b1c…
  Character : Ranger · Deadeye · lvl 82
  Skills    : Twister main setup, Utility

Opening PoBAI at http://localhost:5173 …
```

### Workflow

1. Build and tweak in PoB2 as usual.
2. **Save** in PoB2 (Ctrl+S).
3. Run `node integrations/pob2-addon/export.mjs` from the repo root.
4. Select the build — browser opens to PoBAI with the build already imported.
5. Ask the LLM your question. It uses tools to inspect your actual build data.

---

## Stage 2 — In-app chatbox (future)

The goal is a chat panel that appears directly inside PoB2 when PoBAI is running. This requires patching PoB2's Lua source.

PoB2 uses its own Lua runtime (not Love2D directly). The integration plan:

1. **Hook into PoB2's UI** — add a "PoBAI" button in the sidebar or build panel.
2. **On click** — POST the current build's XML to `localhost:3001/api/build/import` using PoB2's existing HTTP socket library (`lcurl` / LuaSocket).
3. **Render a chat panel** — use PoB2's UI framework to show a simple input + scrollable response area.
4. **Poll for responses** — PoBAI chat is a synchronous POST; poll every 500ms or use a coroutine.

Relevant PoB2 source files to patch (from `PathOfBuildingCommunity/PathOfBuilding-PoE2`):
- `src/Classes/BuildList.lua` — add "Send to PoBAI" to the build list context menu
- `src/Classes/SectionPanel.lua` or equivalent — add the chat panel UI
- `src/Classes/Build.lua` — expose `GetCode()` to generate the export code inline

This is deferred until the export helper proves the concept works end-to-end.

---

## Build file location notes

PoB2 saves builds as `.xml` files. Common locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\PathOfBuilding2\Builds\` |
| macOS | `~/Library/Application Support/PathOfBuilding2/Builds/` |
| Linux | `~/.local/share/PathOfBuilding2/Builds/` |

The files are standard PoB2 XML — the same format the PoBAI server already parses.
