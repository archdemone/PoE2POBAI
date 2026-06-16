#!/usr/bin/env node
/**
 * PoBAI Lua patch installer — auto-discovers PoB2 and patches ImportTab.lua.
 *
 * Usage:
 *   node integrations/pob2-addon/install-patch.mjs
 *   node integrations/pob2-addon/install-patch.mjs --pob2-dir "C:\PathOfBuilding2"
 *   node integrations/pob2-addon/install-patch.mjs --dry-run   (check only, no changes)
 *   node integrations/pob2-addon/install-patch.mjs --revert    (restore backup)
 *
 * Requirements: Node.js >= 22
 */
import { readFile, writeFile, copyFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";

// -------------------------------------------------------------------------
// Patch source — the two blocks from pobai_patch.lua
// -------------------------------------------------------------------------

const HELPER_BLOCK = `
-- [[ PoBAI Integration ]] --
local POBAI_SERVER = "http://localhost:3001"
local POBAI_UI     = "http://localhost:5173"

local function pobai_openBrowser(url)
    if launch.OpenURL then
        launch:OpenURL(url)
    else
        local osName = (jit and jit.os) or ""
        if osName == "Windows" then
            os.execute('start "" "' .. url .. '"')
        elseif osName == "OSX" then
            os.execute('open "' .. url .. '"')
        else
            os.execute('xdg-open "' .. url .. '"')
        end
    end
end

local function pobai_sendBuild(build)
    local ok, code = pcall(function()
        return common.base64.encode(
            Deflate(build:SaveDB("code"))
        ):gsub("+", "-"):gsub("/", "_")
    end)
    if not ok or not code or code == "" then
        print("PoBAI: could not generate export code")
        return
    end
    local label = (build.buildName or "Build"):gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"')
    local jsonBody = '{"source":"pob-code","label":"' .. label .. '","payload":"' .. code .. '"}'
    launch:DownloadPage(
        POBAI_SERVER .. "/api/build/import",
        function(isSuccess, data)
            if isSuccess then
                pobai_openBrowser(POBAI_UI)
            else
                print("PoBAI: server not reachable (" .. tostring(data) .. ")")
                print("Start the server with:  node apps/pobai-server/src/index.mjs")
            end
        end,
        { body = jsonBody, header = "Content-Type: application/json" }
    )
end
-- [[ /PoBAI Integration ]] --
`;

const BUTTON_BLOCK = `
    -- [[ PoBAI Send Button ]] --
    controls.sendToPoBAI = new("ButtonControl",
        { "TOPLEFT", controls.generateCodeOut, "BOTTOMLEFT" },
        { 0, 6, 140, 22 },
        "Send to PoBAI",
        function()
            pobai_sendBuild(self.build)
        end
    )
    controls.sendToPoBAI.tooltipText = "Export this build to PoBAI for AI build advice (opens localhost:5173)"
    -- [[ /PoBAI Send Button ]] --
`;

const SENTINEL = "-- [[ PoBAI Integration ]] --";

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
async function applyPatch(content) {
  // Insert HELPER_BLOCK before newClass("ImportTab"
  const classMarker = 'newClass("ImportTab"';
  const classIdx = content.indexOf(classMarker);
  if (classIdx === -1) {
    return { ok: false, error: `Could not find '${classMarker}' in ImportTab.lua` };
  }

  // Insert BUTTON_BLOCK after controls.generateCodeOut block
  // Find `controls.generateCodeOut` and then find the closing `)` of the EditControl creation
  const genOutMarker = "controls.generateCodeOut";
  const genOutIdx = content.indexOf(genOutMarker);
  if (genOutIdx === -1) {
    return { ok: false, error: `Could not find '${genOutMarker}' in ImportTab.lua` };
  }

  // Find the closing `)` of the new("EditControl", ...) call — track paren depth from genOutIdx
  // We need to find the next `new("EditControl"` or `new("ButtonControl"` after genOutIdx,
  // then find its closing `)`
  const callStart = content.lastIndexOf("new(", genOutIdx);
  const searchFrom = callStart !== -1 ? callStart : genOutIdx;
  let depth = 0;
  let closingParen = -1;
  for (let i = searchFrom; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") {
      depth--;
      if (depth === 0) { closingParen = i; break; }
    }
  }
  if (closingParen === -1) {
    return { ok: false, error: "Could not find closing parenthesis of generateCodeOut declaration" };
  }

  const before = content.slice(0, classIdx);
  const afterClass = content.slice(classIdx);
  const result = before + HELPER_BLOCK + "\n\n" + afterClass;

  // Insert button block after closing paren of generateCodeOut
  const afterGenOut = result.slice(0, closingParen + 1) + "\n" + BUTTON_BLOCK + result.slice(closingParen + 1);

  return { ok: true, content: result };
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "pob2-dir": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    revert: { type: "boolean", default: false },
  },
  strict: false,
});

const pob2Dir = await findPob2Dir(args["pob2-dir"]);
if (!pob2Dir) {
  console.error("\nCould not find PoB2 installation directory.");
  console.error("Tried:");
  candidateInstallDirs().forEach((p) => console.error(`  ${p}`));
  console.error('\nPass the correct path with --pob2-dir "path/to/PoB2"');
  process.exit(1);
}

const importTabPath = join(pob2Dir, "src", "Classes", "ImportTab.lua");
const backupPath = importTabPath + ".bak";

if (args["revert"]) {
  if (!existsSync(backupPath)) {
    console.error(`No backup found at ${backupPath}`);
    process.exit(1);
  }
  await copyFile(backupPath, importTabPath);
  console.log(`✓ Reverted ${importTabPath} from backup`);
  process.exit(0);
}

console.log(`\nPoBAI Lua Patch Installer`);
console.log(`─`.repeat(40));
console.log(`PoB2 dir  : ${pob2Dir}`);
console.log(`Target    : ${importTabPath}\n`);

const content = await readFile(importTabPath, "utf8");

// Check if already patched
if (content.includes(SENTINEL)) {
  console.log("✓ PoBAI patch is already installed (sentinel found).");
  console.log("  Run with --revert to restore the backup.\n");
  process.exit(0);
}

const result = await applyPatch(content);
if (!result.ok) {
  console.error(`✗ ${result.error}`);
  process.exit(1);
}

if (args["dry-run"]) {
  console.log("─── DRY RUN — no changes made ───\n");
  const added = (result.content.length - content.length) / content.length * 100;
  console.log(`Patch would add ${(result.content.length - content.length)} bytes (+${added.toFixed(1)}%)`);
  console.log("Run without --dry-run to apply.\n");
  process.exit(0);
}

// Backup
await copyFile(importTabPath, backupPath);
console.log(`✓ Backup saved to ${backupPath}`);

// Write patched file
await writeFile(importTabPath, result.content, "utf8");
console.log(`✓ Patched ${importTabPath}`);

console.log(`\nDone. Restart PoB2 — a "Send to PoBAI" button will appear in the Export tab.\n`);
