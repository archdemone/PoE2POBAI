#!/usr/bin/env node
/**
 * Build compact passive-tree node indexes for PoBAI from Path of Building 2's
 * bundled TreeData. PoB2 ships GGG's full tree.json per tree version; we only
 * need id -> { name, type, stats } so the compare view can show what each
 * allocated/de-allocated node actually does.
 *
 * Source: <PoB2>/TreeData/<version>/tree.json
 * Output: data/tree/<version>.json  (compact, keyed by node id)
 *
 * Usage:
 *   node scripts/build-tree-index.mjs                  # auto-detect PoB2 install
 *   node scripts/build-tree-index.mjs --pob2-dir "..." # explicit install dir
 *   node scripts/build-tree-index.mjs --versions 0_5,0_4
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "data", "tree");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : true;
  }
  return out;
}

// Candidate PoB2 install/data dirs that contain a TreeData/ folder.
function candidateDirs(explicit) {
  const home = os.homedir();
  const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  return [
    explicit,
    process.env.POB2_DIR,
    process.env.POB2_INSTALL_DIR,
    path.join(roaming, "Path of Building Community (PoE2)"),
    path.join(roaming, "Path of Building Community (PoE2)".replace(/[()]/g, "")),
    path.join(localAppData, "Programs", "PathOfBuilding2"),
    path.join(pf86, "Steam", "steamapps", "common", "Path of Building 2"),
    path.join(pf86, "Steam", "steamapps", "common", "Path of Building PoE2"),
  ].filter(Boolean);
}

function findTreeDataRoot(explicit) {
  for (const dir of candidateDirs(explicit)) {
    const treeData = path.join(dir, "TreeData");
    if (fs.existsSync(treeData) && fs.statSync(treeData).isDirectory()) return treeData;
  }
  return null;
}

function nodeType(node) {
  if (node.isKeystone) return "keystone";
  if (node.isMastery) return "mastery";
  if (node.isJewelSocket) return "jewel";
  if (node.ascendancyName) return "ascendancy";
  if (node.isNotable) return "notable";
  return "small";
}

function buildIndex(treeJsonPath) {
  const tree = JSON.parse(fs.readFileSync(treeJsonPath, "utf8"));
  const nodes = tree.nodes || {};
  const index = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || id === "root") continue;
    if (!node.name && !(node.stats && node.stats.length)) continue;
    const entry = { name: node.name || `Node ${id}`, type: nodeType(node) };
    if (Array.isArray(node.stats) && node.stats.length) entry.stats = node.stats;
    if (node.ascendancyName) entry.ascendancy = node.ascendancyName;
    index[id] = entry;
  }
  return index;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const treeDataRoot = findTreeDataRoot(typeof args["pob2-dir"] === "string" ? args["pob2-dir"] : undefined);
  if (!treeDataRoot) {
    console.error("Could not find a PoB2 TreeData folder. Pass --pob2-dir \"<install>\" or set POB2_DIR.");
    process.exit(1);
  }
  const available = fs.readdirSync(treeDataRoot).filter((v) => fs.existsSync(path.join(treeDataRoot, v, "tree.json")));
  const wanted = typeof args.versions === "string" ? args.versions.split(",").map((s) => s.trim()) : available;
  const versions = wanted.filter((v) => available.includes(v));
  if (!versions.length) {
    console.error(`No matching tree versions. Available: ${available.join(", ")}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  for (const version of versions) {
    const index = buildIndex(path.join(treeDataRoot, version, "tree.json"));
    const outPath = path.join(OUT_DIR, `${version}.json`);
    fs.writeFileSync(outPath, JSON.stringify(index));
    const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
    manifest[version] = { nodes: Object.keys(index).length };
    console.log(`  ${version}: ${Object.keys(index).length} nodes -> data/tree/${version}.json (${sizeKb} KB)`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify({ versions: Object.keys(manifest), ...manifest }, null, 2));
  console.log(`Wrote ${versions.length} tree index file(s) from ${treeDataRoot}`);
}

main();
