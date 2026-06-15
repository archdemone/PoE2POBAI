#!/usr/bin/env node
/**
 * PoBAI file watcher — monitors your PoB2 Builds directory and automatically
 * imports any build you save in PoB2. Pairs with the web UI at localhost:5173.
 *
 * Usage:
 *   node integrations/pob2-addon/watch.mjs
 *   node integrations/pob2-addon/watch.mjs --builds-dir "C:\custom\Builds"
 *   node integrations/pob2-addon/watch.mjs --server http://localhost:3001
 *
 * Requirements: Node.js >= 22. No npm install needed.
 * Keep this running in a terminal while you use PoB2.
 */
import { readFile, access } from "node:fs/promises";
import { watch } from "node:fs";
import { join, extname, basename } from "node:path";
import { homedir, platform } from "node:os";
import { parseArgs } from "node:util";

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
      ];
    case "darwin":
      return [
        join(home, "Library", "Application Support", "PathOfBuilding2", "Builds"),
        join(home, "Library", "Application Support", "PathOfBuilding", "Builds"),
      ];
    default:
      return [
        join(home, ".local", "share", "PathOfBuilding2", "Builds"),
        join(home, ".config", "PathOfBuilding2", "Builds"),
      ];
  }
}

async function findBuildsDir(override) {
  if (override) return override;
  for (const candidate of candidateBuildsDir()) {
    try { await access(candidate); return candidate; } catch {}
  }
  return null;
}

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "builds-dir": { type: "string" },
    server: { type: "string", default: "http://localhost:3001" },
  },
  strict: false,
});

const serverUrl = /** @type {string} */ (args["server"]);
const buildsDir = await findBuildsDir(args["builds-dir"]);

console.log("\nPoBAI file watcher");
console.log("─".repeat(40));

if (!buildsDir) {
  console.error("Could not find PoB2 Builds directory.");
  console.error("Pass --builds-dir \"path/to/Builds\"");
  process.exit(1);
}

console.log(`Watching : ${buildsDir}`);
console.log(`Server   : ${serverUrl}`);
console.log("Waiting for PoB2 saves… (Ctrl+C to stop)\n");

// Debounce: PoB2 sometimes writes a file multiple times per save
const pending = new Map();
const DEBOUNCE_MS = 600;

async function importFile(filename) {
  if (extname(filename).toLowerCase() !== ".xml") return;
  const label = basename(filename, ".xml");
  const filePath = join(buildsDir, filename);

  let xml;
  try {
    xml = await readFile(filePath, "utf8");
  } catch {
    return; // file might have been deleted or is mid-write
  }

  let res;
  try {
    res = await fetch(`${serverUrl}/api/build/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "pob-xml", label, payload: xml }),
    });
  } catch {
    console.error(`[${label}] ✗ Cannot reach PoBAI server at ${serverUrl}`);
    return;
  }

  if (!res.ok) {
    console.error(`[${label}] ✗ Import failed (HTTP ${res.status})`);
    return;
  }

  const data = await res.json();
  const char = data.snapshot?.summary?.character ?? {};
  const charStr = [char.className, char.ascendancy, char.level ? `lvl ${char.level}` : ""]
    .filter(Boolean).join(" · ");

  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ✓ ${label}${charStr ? `  —  ${charStr}` : ""}`);
}

watch(buildsDir, (event, filename) => {
  if (!filename || extname(filename).toLowerCase() !== ".xml") return;
  if (pending.has(filename)) clearTimeout(pending.get(filename));
  pending.set(filename, setTimeout(() => {
    pending.delete(filename);
    importFile(filename).catch(() => {});
  }, DEBOUNCE_MS));
});
