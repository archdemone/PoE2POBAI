#!/usr/bin/env node
/**
 * PoBAI export helper — reads saved PoB2 builds from disk and sends them to PoBAI.
 *
 * Usage:
 *   node export.mjs
 *   node export.mjs --builds-dir "C:\custom\path\Builds"
 *   node export.mjs --server http://localhost:3001 --ui http://localhost:3001
 *   node export.mjs --label "My Twister" --pick 2   (non-interactive, pick build #2)
 *
 * Requirements: Node.js >= 22 (no npm install needed)
 */
import { readdir, readFile, access } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { homedir, platform } from "node:os";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { exec } from "node:child_process";

// ---------------------------------------------------------------------------
// Platform-specific PoB2 candidate paths (tried in order)
// ---------------------------------------------------------------------------
function candidateBuildsDir() {
  const home = homedir();
  const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
  const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");

  switch (platform()) {
    case "win32":
      return [
        join(appData, "PathOfBuilding2", "Builds"),
        join(appData, "PathOfBuilding", "Builds"),
        join(localAppData, "PathOfBuilding2", "Builds"),
        join(localAppData, "Programs", "PathOfBuilding2", "Builds"),
      ];
    case "darwin":
      return [
        join(home, "Library", "Application Support", "PathOfBuilding2", "Builds"),
        join(home, "Library", "Application Support", "PathOfBuilding", "Builds"),
      ];
    default: // Linux
      return [
        join(home, ".local", "share", "PathOfBuilding2", "Builds"),
        join(home, ".local", "share", "pathofbuilding2", "Builds"),
        join(home, ".config", "PathOfBuilding2", "Builds"),
      ];
  }
}

async function findBuildsDir(override) {
  if (override) return override;
  for (const candidate of candidateBuildsDir()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minimal XML parser — no deps, extracts just enough for the menu display
// ---------------------------------------------------------------------------
function attr(xml, tag, key) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${key}="([^"]*)"`, "i"));
  return match?.[1] ?? "";
}

function quickParse(xml) {
  return {
    name: attr(xml, "Build", "characterName") || attr(xml, "Build", "name"),
    className: attr(xml, "Build", "className") || attr(xml, "Build", "class"),
    ascendancy: attr(xml, "Build", "ascendClassName") || attr(xml, "Build", "ascendancyName"),
    level: attr(xml, "Build", "level"),
  };
}

function menuLabel({ name, className, ascendancy, level }) {
  const cls = [className, ascendancy].filter(Boolean).join(" / ");
  const lvl = level ? `lvl ${level}` : "";
  const char = name ? `"${name}"` : "";
  return [cls, lvl, char].filter(Boolean).join("  ") || "(unrecognised build format)";
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "builds-dir": { type: "string" },
    server: { type: "string", default: "http://localhost:3001" },
    ui: { type: "string", default: "http://localhost:3001" },
    label: { type: "string" },
    pick: { type: "string" }, // non-interactive: pick build by number
  },
  strict: false,
});

const serverUrl = /** @type {string} */ (args["server"]);
const uiUrl = /** @type {string} */ (args["ui"]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log("\nPoBAI — Path of Building 2 export tool");
console.log("─".repeat(45));

const buildsDir = await findBuildsDir(args["builds-dir"]);

if (!buildsDir) {
  const candidates = candidateBuildsDir();
  console.error("\nCould not find your PoB2 Builds directory.");
  console.error("Tried:");
  candidates.forEach((p) => console.error(`  ${p}`));
  console.error('\nPass the correct path with --builds-dir "path/to/Builds"');
  console.error("or save at least one build in PoB2 first.");
  process.exit(1);
}

console.log(`Builds dir : ${buildsDir}`);
console.log(`Server     : ${serverUrl}`);
console.log(`UI         : ${uiUrl}\n`);

// List .xml files
let entries;
try {
  entries = (await readdir(buildsDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && extname(e.name).toLowerCase() === ".xml"
  );
} catch (e) {
  console.error(`Cannot read builds directory: ${e.message}`);
  process.exit(1);
}

if (entries.length === 0) {
  console.log("No .xml build files found. Save a build in PoB2 first.");
  process.exit(0);
}

// Load each file (small XMLs, safe to read all upfront)
const builds = await Promise.all(
  entries.map(async (entry, i) => {
    const path = join(buildsDir, entry.name);
    const xml = await readFile(path, "utf8");
    return {
      index: i + 1,
      filename: entry.name,
      displayName: basename(entry.name, ".xml"),
      path,
      xml,
      info: quickParse(xml),
    };
  })
);

// Display menu
builds.forEach((b) => {
  console.log(`  ${String(b.index).padStart(2)}. ${b.displayName.padEnd(30)} ${menuLabel(b.info)}`);
});
console.log();

// Pick build (interactive or --pick)
let selected;
if (args["pick"]) {
  const n = parseInt(args["pick"], 10);
  selected = builds.find((b) => b.index === n);
  if (!selected) {
    console.error(`--pick ${args["pick"]} is out of range (1–${builds.length}).`);
    process.exit(1);
  }
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question("Select build number (or Enter to cancel): ", resolve)
  );
  rl.close();

  const n = parseInt(answer.trim(), 10);
  if (!n || n < 1 || n > builds.length) {
    console.log("Cancelled.");
    process.exit(0);
  }
  selected = builds[n - 1];
}

const label = args["label"] ?? selected.displayName;
console.log(`\nImporting "${label}" …`);

// POST to PoBAI server
let res;
try {
  res = await fetch(`${serverUrl}/api/build/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "pob-xml", label, payload: selected.xml }),
  });
} catch (e) {
  console.error(`\nCannot connect to PoBAI server at ${serverUrl}`);
  console.error("Make sure the server is running:");
  console.error("  node apps/pobai-server/src/index.mjs");
  console.error("  (or: npm run dev from the repo root)");
  process.exit(1);
}

if (!res.ok) {
  console.error(`\nImport failed (HTTP ${res.status}): ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const snap = data.snapshot;

console.log(`✓ Imported — snapshot ${snap?.id?.slice(0, 8)}…`);

const char = snap?.summary?.character ?? {};
const charStr = [char.className, char.ascendancy, char.level ? `lvl ${char.level}` : ""]
  .filter(Boolean)
  .join(" · ");
if (charStr) console.log(`  Character : ${charStr}`);

const skills = snap?.summary?.skills ?? [];
if (skills.length) console.log(`  Skills    : ${skills.map((s) => s.label).join(", ")}`);

const warnings = snap?.summary?.warnings ?? [];
if (warnings.length) console.log(`  Warnings  : ${warnings.join(" | ")}`);

// Open browser
console.log(`\nOpening PoBAI at ${uiUrl} …`);

const opener = {
  win32: `start "" "${uiUrl}"`,
  darwin: `open "${uiUrl}"`,
}[platform()] ?? `xdg-open "${uiUrl}"`;

exec(opener, (err) => {
  if (err) {
    console.log(`Could not open browser automatically.`);
    console.log(`Visit ${uiUrl} manually — your build is already imported.`);
  }
});
