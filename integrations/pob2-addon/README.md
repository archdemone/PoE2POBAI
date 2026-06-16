# PoB2 → PoBAI integration

Three tools:
- **`export.mjs`** — CLI picker: reads saved PoB2 builds from disk and sends one to PoBAI (works immediately, no PoB2 modification).
- **`watch.mjs`** — auto-importer: watches your PoB2 Builds directory and imports on every save.
- **`install-patch.mjs`** — in-app button: patches PoB2's `ImportTab.lua` to add a "Send to PoBAI" button inside PoB2 itself.

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

## Stage 2 — In-app export button

Adds a "Send to PoBAI" button inside PoB2's Export tab. Clicking it exports the current build to PoBAI and opens the chat UI in your browser.

### Auto-install (recommended)

```bash
node integrations/pob2-addon/install-patch.mjs
```

Optional flags:

| Flag | Description |
|------|-------------|
| `--pob2-dir "path"` | Override auto-detected PoB2 install directory |
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

- PoBAI server running: `node apps/pobai-server/src/index.mjs` (or `npm run dev`)
- Node.js 22+

---

## Build file location notes

PoB2 saves builds as `.xml` files. Common locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\PathOfBuilding2\Builds\` |
| macOS | `~/Library/Application Support/PathOfBuilding2/Builds/` |
| Linux | `~/.local/share/PathOfBuilding2/Builds/` |

The files are standard PoB2 XML — the same format the PoBAI server already parses.
