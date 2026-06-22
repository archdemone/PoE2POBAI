#!/usr/bin/env node
/**
 * PoBAI Bridge v2 installer — patches PoB2 for bidirectional bridge.
 *
 * What it does:
 *   1. Copies pobai_bridge.lua → PoB2's runtime/lua/ directory (so require() works)
 *   2. Patches ImportTab.lua → exposes build globally, starts/polls HTTP listener
 *   3. Patches CalcsTab.lua → exposes calc engine globally
 *
 * Usage:
 *   node integrations/pob2-addon/install-bridge.mjs
 *   node integrations/pob2-addon/install-bridge.mjs --pob2-dir "C:\PathOfBuilding2"
 *   node integrations/pob2-addon/install-bridge.mjs --dry-run
 *   node integrations/pob2-addon/install-bridge.mjs --revert
 *   set POB2_DIR=C:\PathOfBuilding2
 *
 * Requirements: Node.js >= 22
 */
import { readFile, writeFile, copyFile, access, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// -------------------------------------------------------------------------
// Patch blocks
// -------------------------------------------------------------------------

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

const IMPORTPAB_PREAMBLE = `
-- [[ PoBAI Bridge ]] --
_G.pobai_bridge_active = _G.pobai_bridge_active or false

local function pobai_bridge_ensure_loaded()
    if _G.pobai_bridge then
        return true
    end
    local ok, bridge_or_error = pcall(require, "pobai_bridge")
    if ok and bridge_or_error then
        _G.pobai_bridge = bridge_or_error
        return true
    end
    print("PoBAI Bridge: could not load pobai_bridge.lua (" .. tostring(bridge_or_error) .. ")")
    return false
end

pobai_bridge_ensure_loaded()

local function pobai_bridge_tick()
    if pobai_bridge_ensure_loaded() and _G.pobai_bridge then
        _G.pobai_bridge:poll()
    end
end

-- Poll the bridge every main loop frame (scheduled by the constructor hook)
-- [[ /PoBAI Bridge ]] --
`;

const IMPORTPAB_CONSTRUCTOR_HOOK = `
    -- [[ PoBAI Bridge: init ]] --
    _G.pobai_current_build = self.build
    if pobai_bridge_ensure_loaded() and _G.pobai_bridge and not _G.pobai_bridge_active then
        _G.pobai_bridge:start()
        _G.pobai_bridge_active = true
        -- Schedule polling in the main loop
        if main and main.schedule then
            main:schedule(pobai_bridge_tick, 0)
        end
    end
    -- [[ /PoBAI Bridge ]] --
`;

const IMPORTPAB_CLOSE_HOOK = `
    -- [[ PoBAI Bridge: stop ]] --
    if _G.pobai_bridge and _G.pobai_bridge_active then
        _G.pobai_bridge:stop()
        _G.pobai_bridge_active = false
    end
    -- [[ /PoBAI Bridge ]] --
`;

const CALCSTAB_HOOK = `
    -- [[ PoBAI Bridge: expose calcs ]] --
    _G.pobai_calcs_module = self.calcs
    -- [[ /PoBAI Bridge ]] --
`;

const SENTINEL = "-- [[ PoBAI Bridge ]] --";
const CALCS_SENTINEL = "-- [[ PoBAI Bridge: expose calcs ]] --";

// -------------------------------------------------------------------------
// Platform-specific PoB2 install candidates
// -------------------------------------------------------------------------
function candidateInstallDirs() {
  const home = homedir();
  const pf = process.env["ProgramW6432"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");

  switch (platform()) {
    case "win32":
      return [
        join(localAppData, "PathOfBuilding2"),
        join(localAppData, "PathOfBuilding", "PoE2"),
        join(pf, "PathOfBuilding2"),
        join(pf, "PathOfBuilding", "PoE2"),
        join(pf86, "Steam", "steamapps", "common", "Path of Building 2"),
        join(pf86, "Steam", "steamapps", "common", "Path of Building PoE2"),
      ];
    case "darwin":
      return [
        "/Applications/Path of Building 2.app/Contents/Resources",
        join(home, "Applications", "Path of Building 2.app", "Contents", "Resources"),
      ];
    default:
      return [
        "/opt/PathOfBuilding2",
        join(home, ".local", "share", "PathOfBuilding2"),
      ];
  }
}

async function findPob2Dir(override) {
  if (override) return override;
  for (const candidate of candidateInstallDirs()) {
    if (existsSync(join(candidate, "src", "Classes", "ImportTab.lua"))) {
      return candidate;
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// Patch logic
// -------------------------------------------------------------------------
function findInsertPoint(content, marker) {
  const idx = content.indexOf(marker);
  return idx !== -1 ? idx + marker.length : -1;
}

function insertBefore(content, marker, block) {
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  return content.slice(0, idx) + "\n" + block + "\n" + content.slice(idx);
}

function insertAfter(content, marker, block) {
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  return content.slice(0, idx + marker.length) + "\n" + block + "\n" + content.slice(idx + marker.length);
}

async function patchImportTab(content) {
  // 1. Insert preamble before newClass("ImportTab")
  let result = insertBefore(content, 'newClass("ImportTab"', IMPORTPAB_PREAMBLE);
  if (!result) return { ok: false, error: "Could not find 'newClass(\"ImportTab\")' marker" };

  // 2. Insert constructor hook after self.build = ... or after the controls block
  //    Find a safe anchor: the line where self.build is first assigned
  const buildAnchor = "self.build =";
  const buildIdx = result.indexOf(buildAnchor);
  if (buildIdx === -1) return { ok: false, error: "Could not find 'self.build =' in ImportTab" };

  const buildLineEnd = result.indexOf("\n", buildIdx);
  if (buildLineEnd === -1) return { ok: false, error: "Unexpected file structure" };
  result = result.slice(0, buildLineEnd + 1) + IMPORTPAB_CONSTRUCTOR_HOOK + result.slice(buildLineEnd + 1);

  // 3. Insert close hook inside the close() method
  const closeAnchor = 'function '
  // First try "close" method patterns
  const closeMethods = ['self.close = function()', 'function ImportTabClass:close'];
  let closeIdx = -1;
  for (const m of closeMethods) {
    closeIdx = result.indexOf(m);
    if (closeIdx !== -1) break;
  }
  if (closeIdx === -1) {
    // Fallback: find "controls.import" area and insert near the end
    // (ImportTab may not have an explicit close method — skip close hook)
    console.log("  (no close method found — skipping close hook)");
  } else {
    // Insert after the function opening
    const fnBodyStart = result.indexOf("\n", closeIdx);
    if (fnBodyStart !== -1) {
      result = result.slice(0, fnBodyStart + 1) + IMPORTPAB_CLOSE_HOOK + result.slice(fnBodyStart + 1);
    }
  }

  return { ok: true, content: result };
}

async function patchCalcsTab(content) {
  // Insert after `self.calcs = LoadModule("Modules/Calcs")`
  const calcsAnchor = 'self.calcs = LoadModule("Modules/Calcs")';
  let result = insertAfter(content, calcsAnchor, CALCSTAB_HOOK);
  if (result) return { ok: true, content: result };

  // Fallback: try variations
  const altAnchor = 'LoadModule("Modules/Calcs")';
  result = insertAfter(content, altAnchor, CALCSTAB_HOOK);
  if (result) return { ok: true, content: result };

  return { ok: false, error: "Could not find calc module load in CalcsTab.lua" };
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------
function printHelp() {
  console.log(`PoBAI Bridge v2 Installer

Usage:
  node integrations/pob2-addon/install-bridge.mjs [options]

Options:
  --pob2-dir "path"  PoB2 install directory. Also reads POB2_DIR.
  --dry-run          Check what would change without modifying PoB2.
  --revert           Restore backups created by this installer.
  --help             Show this help.
`);
}

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "pob2-dir": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    revert: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: false,
});

if (args.help) {
  printHelp();
  process.exit(0);
}

const pob2Dir = await findPob2Dir(args["pob2-dir"] ?? process.env.POB2_DIR ?? process.env.POB2_INSTALL_DIR);
if (!pob2Dir) {
  console.error("\nCould not find PoB2 installation directory.");
  console.error("Tried:");
  candidateInstallDirs().forEach((p) => console.error(`  ${p}`));
  console.error('\nPass the correct path with --pob2-dir "path/to/PoB2"');
  console.error('or set POB2_DIR before running the installer.');
  process.exit(1);
}

const importTabPath = join(pob2Dir, "src", "Classes", "ImportTab.lua");
const calcsTabPath = join(pob2Dir, "src", "Classes", "CalcsTab.lua");
const bridgeDestDir = join(pob2Dir, "runtime", "lua");
const bridgeDestPath = join(bridgeDestDir, "pobai_bridge.lua");
const bridgeSrcPath = join(THIS_DIR, "pobai_bridge.lua");

const importBackupPath = importTabPath + ".bak";
const calcsBackupPath = calcsTabPath + ".bak";

if (args["revert"]) {
  if (!existsSync(importBackupPath)) {
    console.error(`No backup found for ImportTab at ${importBackupPath}`);
    process.exit(1);
  }
  await copyFile(importBackupPath, importTabPath);
  console.log(`✓ Reverted ${importTabPath}`);

  if (existsSync(calcsBackupPath)) {
    await copyFile(calcsBackupPath, calcsTabPath);
    console.log(`✓ Reverted ${calcsTabPath}`);
  }

  if (existsSync(bridgeDestPath)) {
    await copyFile(bridgeDestPath, bridgeDestPath + ".bak");
    console.log(`✓ Preserved ${bridgeDestPath} (remove manually if unwanted)`);
  }
  process.exit(0);
}

console.log(`\nPoBAI Bridge v2 Installer`);
console.log(`─`.repeat(50));
console.log(`PoB2 dir : ${pob2Dir}`);
console.log(`Targets  :`);
console.log(`  ${importTabPath}`);
console.log(`  ${calcsTabPath}`);
console.log(`  ${bridgeDestPath}\n`);

// --- Step 1: Copy pobai_bridge.lua to runtime/lua/ ---
if (!existsSync(bridgeSrcPath)) {
  console.error(`✗ Bridge source not found at ${bridgeSrcPath}`);
  process.exit(1);
}

if (!args["dry-run"]) {
  if (!existsSync(bridgeDestDir)) {
    await mkdir(bridgeDestDir, { recursive: true });
  }
  await copyFile(bridgeSrcPath, bridgeDestPath);
  console.log(`✓ Copied bridge file → ${bridgeDestPath}`);
} else {
  console.log(`  [dry-run] Would copy ${bridgeSrcPath} → ${bridgeDestPath}`);
}

// --- Step 2: Backup and patch ImportTab.lua ---
let importContent;
try {
  importContent = await readFile(importTabPath, "utf8");
} catch (e) {
  console.error(`✗ Cannot read ImportTab.lua: ${e.message}`);
  process.exit(1);
}

if (importContent.includes(SENTINEL)) {
  console.log("  ImportTab.lua already patched (sentinel found). Run with --revert to undo.");
} else {
  const importResult = await patchImportTab(importContent);
  if (!importResult.ok) {
    console.error(`✗ ImportTab patch failed: ${importResult.error}`);
    process.exit(1);
  }

  if (!args["dry-run"]) {
    await copyFile(importTabPath, importBackupPath);
    console.log(`✓ Backup → ${importBackupPath}`);
    await writeFile(importTabPath, importResult.content, "utf8");
    console.log(`✓ Patched ImportTab.lua`);
  } else {
    const added = ((importResult.content.length - importContent.length) / importContent.length * 100).toFixed(1);
    console.log(`  [dry-run] Would patch ImportTab.lua (+${added}%)`);
  }
}

// --- Step 3: Backup and patch CalcsTab.lua ---
let calcsContent;
try {
  calcsContent = await readFile(calcsTabPath, "utf8");
} catch (e) {
  console.log(`  (CalcsTab.lua not found at ${calcsTabPath} — skipping)`);
  calcsContent = null;
}

if (calcsContent) {
  if (calcsContent.includes(CALCS_SENTINEL)) {
    console.log("  CalcsTab.lua already patched (sentinel found).");
  } else {
    const calcsResult = await patchCalcsTab(calcsContent);
    if (!calcsResult.ok) {
      console.error(`✗ CalcsTab patch failed: ${calcsResult.error}`);
      console.log("  (The bridge will still work — calc access will need manual setup)");
    } else {
      if (!args["dry-run"]) {
        await copyFile(calcsTabPath, calcsBackupPath);
        console.log(`✓ Backup → ${calcsBackupPath}`);
        await writeFile(calcsTabPath, calcsResult.content, "utf8");
        console.log(`✓ Patched CalcsTab.lua`);
      } else {
        const added = ((calcsResult.content.length - calcsContent.length) / calcsContent.length * 100).toFixed(1);
        console.log(`  [dry-run] Would patch CalcsTab.lua (+${added}%)`);
      }
    }
  }
}

if (args["dry-run"]) {
  console.log(`\n─── DRY RUN — no changes made ───`);
} else {
  console.log(`\n✓ Installation complete. Restart PoB2.`);
  console.log(`  The bridge will listen on 127.0.0.1:${22804} for PoBAI server commands.`);
}

// Check if server is running
console.log(``);
try {
  const res = await fetch("http://localhost:3001/health", { signal: AbortSignal.timeout(2000) });
  if (res.ok) {
    console.log(`  PoBAI server: RUNNING (localhost:3001) ✓`);
  }
} catch {
  console.log(`  PoBAI server: NOT RUNNING — start with: npm run dev`);
}
