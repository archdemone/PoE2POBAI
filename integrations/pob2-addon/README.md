# PoB2 → PoBAI integration

Four tools:
- **`export.mjs`** — CLI picker: reads saved PoB2 builds from disk and sends one to PoBAI (works immediately, no PoB2 modification).
- **`watch.mjs`** — auto-importer: watches your PoB2 Builds directory and imports on every save.
- **`install-patch.mjs`** — in-app button: patches PoB2's `ImportTab.lua` to add a "Send to PoBAI" button inside PoB2 itself.
- **`install-bridge.mjs`** — experimental bidirectional bridge installer for live PoB2 calculations and full-build XML what-if tests.

---

## Recommended Windows launch

From the repo root:

```bat
start.bat
```

This builds PoBAI, starts the local website/API at `http://localhost:3001`, opens the browser, and launches PoB2 when it can find the executable.

If PoB2 is not detected, configure either the executable or install directory:

```bat
set POB2_EXE=C:\PathOfBuilding2\Path of Building.exe
set POB2_DIR=C:\PathOfBuilding2
start.bat
```

You can also pass paths directly:

```bat
start.bat --pob-exe "C:\PathOfBuilding2\Path of Building.exe"
start.bat --pob2-dir "C:\PathOfBuilding2"
```

To install the experimental live bridge during launch, run:

```bat
start.bat --pob2-dir "C:\PathOfBuilding2" --bridge-dry-run
start.bat --pob2-dir "C:\PathOfBuilding2" --install-bridge
```

Use the dry run first. The bridge installer patches PoB2 files and creates backups.

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
| `--ui` | `http://localhost:3001` | PoBAI web UI URL |
| `--label` | filename | Override the snapshot label |
| `--pick N` | interactive | Non-interactive: select build N without prompting |

### Example session

```
PoBAI — Path of Building 2 export tool
─────────────────────────────────────────────
Builds dir : C:\Users\you\AppData\Roaming\PathOfBuilding2\Builds
Server     : http://localhost:3001
UI         : http://localhost:3001

   1. TwisterDeadeye                     Ranger / Deadeye  lvl 82  "Smokewraith"
   2. FireballSorceress                  Sorceress  lvl 67
   3. TestBuild                          (unrecognised build format)

Select build number (or Enter to cancel): 1

Importing "TwisterDeadeye" …
✓ Imported — snapshot a3f92b1c…
  Character : Ranger · Deadeye · lvl 82
  Skills    : Twister main setup, Utility

Opening PoBAI at http://localhost:3001 …
```

### Workflow

1. Build and tweak in PoB2 as usual.
2. **Save** in PoB2 (Ctrl+S).
3. Run `node integrations/pob2-addon/export.mjs` from the repo root.
4. Select the build — browser opens to PoBAI with the build already imported.
5. Ask the LLM your question. It uses tools to inspect your actual build data.

---

## Stage 2 — In-app export button

Adds a "Send to PoBAI" button inside PoB2's Export tab. Clicking it exports the current build to PoBAI and opens the chat UI in your browser.

### Auto-install (recommended)

```bash
node integrations/pob2-addon/install-patch.mjs
```

Optional flags:

| Flag | Description |
|------|-------------|
| `--pob2-dir "path"` | Override auto-detected PoB2 install directory. Also reads `POB2_DIR` |
| `--dry-run` | Check what would change without modifying anything |
| `--revert` | Restore backup and undo the patch |

The script:
1. Auto-detects your PoB2 install directory (standalone / Steam / macOS / Linux)
2. Backs up `ImportTab.lua` → `ImportTab.lua.bak`
3. Injects the helper functions and "Send to PoBAI" button into `ImportTab.lua`
4. You restart PoB2 and the button appears in the Export tab

### Manual install (if auto-patcher fails)

1. Open `<PoB2 install>/src/Classes/ImportTab.lua`
2. Find `newClass("ImportTab"` — paste the HELPER FUNCTIONS block from `pobai_patch.lua` before it
3. Find `controls.generateCodeOut` — paste the BUTTON BLOCK from `pobai_patch.lua` after its closing `)`
4. Save and restart PoB2

### Requirements

- PoBAI server running: `start.bat` or `npm run launch`
- Node.js 22+

---

## Stage 3 — Experimental live calculation bridge

`install-bridge.mjs` installs `pobai_bridge.lua`, patches PoB2 so PoBAI can call a local bridge on `127.0.0.1:22804`, and exposes the calc module for live stat reads.

```bash
node integrations/pob2-addon/install-bridge.mjs
```

Optional flags:

| Flag | Description |
|------|-------------|
| `--pob2-dir "path"` | Override auto-detected PoB2 install directory. Also reads `POB2_DIR` |
| `--dry-run` | Check what would change without modifying anything |
| `--revert` | Restore backups and undo the patch |

Current maturity:
- Tested against the Node mock bridge and static Lua/installer checks.
- Not yet validated in a real PoB2 runtime.
- Requires PoB2 to provide LuaSocket (`socket`) and `dkjson`.
- What-if tools import full modified build XML. They do not safely patch partial `<Skill>` or `<Item>` fragments.
- A what-if import can mutate the active PoB2 build. Export the current build first so it can be restored.

---

## Build file location notes

PoB2 saves builds as `.xml` files. Common locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\PathOfBuilding2\Builds\` |
| macOS | `~/Library/Application Support/PathOfBuilding2/Builds/` |
| Linux | `~/.local/share/PathOfBuilding2/Builds/` |

The files are standard PoB2 XML — the same format the PoBAI server already parses.
