/**
 * Passive-tree node lookup for the build-compare view.
 *
 * Reads the compact per-version node indexes under data/tree/<version>.json
 * (generated from Path of Building 2's TreeData by scripts/build-tree-index.mjs).
 * Each index maps a passive node id to { name, type, stats }, so the compare
 * engine can tell the user what each allocated / de-allocated node actually does
 * instead of showing a bare numeric id.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const TREE_DIR = resolve(fileURLToPath(new URL("../../../data/tree", import.meta.url)));

const cache = new Map(); // normalizedVersion -> index object (or null)
let availableVersions = null;

function listVersions() {
  if (availableVersions) return availableVersions;
  try {
    availableVersions = readdirSync(TREE_DIR)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .map((f) => f.replace(/\.json$/, ""))
      // Numeric major_minor ordering so "0_10" sorts after "0_9" (not lexically).
      .sort((a, b) => {
        const [aMaj = 0, aMin = 0] = a.split("_").map((n) => Number(n) || 0);
        const [bMaj = 0, bMin = 0] = b.split("_").map((n) => Number(n) || 0);
        return aMaj - bMaj || aMin - bMin;
      });
  } catch {
    availableVersions = [];
  }
  return availableVersions;
}

// "0.5.0" / "0_5" / "v0.5" -> "0_5"; falls back to the raw token when it has no digits.
export function normalizeVersion(version) {
  const groups = String(version ?? "").match(/\d+/g);
  if (!groups || groups.length === 0) return "";
  return groups.slice(0, 2).join("_");
}

function loadFile(normalized) {
  if (cache.has(normalized)) return cache.get(normalized);
  const file = join(TREE_DIR, `${normalized}.json`);
  let index = null;
  if (existsSync(file)) {
    try {
      index = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      index = null;
    }
  }
  cache.set(normalized, index);
  return index;
}

/**
 * Resolve a tree index for a build's treeVersion. Prefers an exact version match;
 * if that version isn't bundled, falls back to the newest available index and
 * marks the result approximate (node ids can shift slightly between versions).
 * Returns null when no tree data is available at all.
 */
export function resolveTreeIndex(version) {
  const normalized = normalizeVersion(version);
  if (normalized) {
    const exact = loadFile(normalized);
    if (exact) return { version: normalized, exact: true, index: exact };
  }
  const versions = listVersions();
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  const index = loadFile(latest);
  if (!index) return null;
  return { version: latest, exact: false, index };
}

/**
 * Enrich a list of node ids with names / type / stats, grouped by node type and
 * ordered keystones → notables → masteries → ascendancy → jewel → small.
 */
const TYPE_ORDER = ["keystone", "notable", "mastery", "ascendancy", "jewel", "small"];

export function describeNodes(ids, treeIndex) {
  const groups = {};
  let named = 0;
  for (const id of ids ?? []) {
    const entry = treeIndex?.index?.[String(id)];
    const type = entry?.type ?? "unknown";
    const node = {
      id: String(id),
      name: entry?.name ?? `Node ${id}`,
      type,
      stats: entry?.stats ?? [],
      ascendancy: entry?.ascendancy,
    };
    if (entry) named += 1;
    (groups[type] ??= []).push(node);
  }
  const orderedGroups = {};
  for (const type of [...TYPE_ORDER, "unknown"]) {
    if (groups[type]?.length) orderedGroups[type] = groups[type].sort((a, b) => a.name.localeCompare(b.name));
  }
  return { groups: orderedGroups, named, total: (ids ?? []).length };
}
