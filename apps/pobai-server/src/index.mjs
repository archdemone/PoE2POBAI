import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuild } from "@pobai/parser";
import { Poe2McpClient } from "./poe2-mcp-client.mjs";
import { resolveToXml, ImportError } from "./import-resolver.mjs";
import { resolveTreeIndex, describeNodes } from "./tree-data.mjs";

// PORT is set by Render/Railway; POBAI_SERVER_PORT is the local dev override
const port = Number(process.env.PORT ?? process.env.POBAI_SERVER_PORT ?? 3001);
const host = process.env.POBAI_SERVER_HOST ?? "0.0.0.0";
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const POB2_BRIDGE_URL = process.env.POB2_BRIDGE_URL ?? "http://127.0.0.1:22804";

const poe2Mcp = new Poe2McpClient();
// Serve from docs/ (production build) when available, otherwise apps/pobai-web/ (dev)
const docsRoot = resolve(fileURLToPath(new URL("../../../docs", import.meta.url)));
const webRoot = existsSync(join(docsRoot, "index.html"))
  ? docsRoot
  : resolve(fileURLToPath(new URL("../../pobai-web", import.meta.url)));
const dataRoot = resolve(process.env.POBAI_DATA_DIR ?? fileURLToPath(new URL("../../../data/snapshots", import.meta.url)));
const snapshots = new Map();
const payloads = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function metadataPath(snapshotId) {
  return join(dataRoot, `${snapshotId}.json`);
}

function payloadPath(snapshotId) {
  return join(dataRoot, `${snapshotId}.payload.txt`);
}

async function ensureDataDir() {
  await mkdir(dataRoot, { recursive: true });
}

async function loadSnapshotsFromDisk() {
  await ensureDataDir();
  const entries = await readdir(dataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const snapshot = JSON.parse(await readFile(join(dataRoot, entry.name), "utf8"));
      if (snapshot?.id) snapshots.set(snapshot.id, snapshot);
    } catch (error) {
      console.warn(`Skipping unreadable snapshot metadata ${entry.name}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function persistSnapshot(snapshot, payload) {
  await ensureDataDir();
  await writeFile(metadataPath(snapshot.id), JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(payloadPath(snapshot.id), payload, "utf8");
}

async function deleteSnapshot(snapshotId) {
  snapshots.delete(snapshotId);
  payloads.delete(snapshotId);
  for (const path of [metadataPath(snapshotId), payloadPath(snapshotId)]) {
    try {
      await unlink(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(text);
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 15 * 1024 * 1024) {
      throw new Error("Request body is larger than 15 MB.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateImportPayload(body) {
  const validSources = new Set(["pob-code", "pob-xml", "poe-ninja", "ggg-profile"]);
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  if (!validSources.has(body.source)) return "source must be one of pob-code, pob-xml, poe-ninja, or ggg-profile.";
  const payload = typeof body.payload === "string" ? body.payload : body.code;
  if (typeof payload !== "string" || payload.trim().length === 0) return "payload is required.";
  if (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length === 0 || body.label.length > 120)) {
    return "label must be a non-empty string up to 120 characters when provided.";
  }
  return null;
}

function validateChatPayload(body) {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  if (typeof body.model !== "string" || body.model.trim().length === 0) return "model is required.";
  if (!Array.isArray(body.messages) || body.messages.length === 0) return "messages must be a non-empty array.";
  for (const message of body.messages) {
    if (!message || typeof message !== "object") return "Each message must be an object.";
    if (!["system", "user", "assistant"].includes(message.role)) return "Each message role must be system, user, or assistant.";
    if (typeof message.content !== "string" || message.content.trim().length === 0) return "Each message must include content.";
  }
  return null;
}

function validateComparePayload(body) {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  if (typeof body.baseId !== "string" || body.baseId.trim().length === 0) return "baseId is required.";
  if (typeof body.targetId !== "string" || body.targetId.trim().length === 0) return "targetId is required.";
  return null;
}

function normalizeCompareKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function displayValue(value) {
  return value === undefined || value === null ? null : value;
}

function parseNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!/^[-+]?\d+(?:\.\d+)?%?$/.test(normalized)) return null;
  return Number(normalized.replace(/%$/, ""));
}

// A stat within this relative (or absolute) band of the other build is treated
// as "close enough" and rendered neutral/white instead of green/red.
const DEFAULT_TOLERANCE_PCT = 2;
const DEFAULT_ABS_FLOOR = 1;

function compareValue(key, baseRaw, targetRaw, options = {}) {
  const basePresent = baseRaw !== undefined && baseRaw !== null && baseRaw !== "";
  const targetPresent = targetRaw !== undefined && targetRaw !== null && targetRaw !== "";
  const baseNumeric = parseNumericValue(baseRaw);
  const targetNumeric = parseNumericValue(targetRaw);

  if (!basePresent && targetPresent) {
    return {
      key,
      label: options.label ?? key,
      category: options.category ?? "stat",
      type: targetNumeric === null ? "text" : "numeric",
      baseValue: null,
      targetValue: displayValue(targetRaw),
      delta: null,
      percentDelta: null,
      direction: "added",
      changed: true,
      status: "added",
      higherIsBetter: options.higherIsBetter ?? null,
      impact: options.higherIsBetter === true ? "better" : "changed",
      color: options.higherIsBetter === true ? "green" : "neutral",
    };
  }

  if (basePresent && !targetPresent) {
    return {
      key,
      label: options.label ?? key,
      category: options.category ?? "stat",
      type: baseNumeric === null ? "text" : "numeric",
      baseValue: displayValue(baseRaw),
      targetValue: null,
      delta: null,
      percentDelta: null,
      direction: "removed",
      changed: true,
      status: "removed",
      higherIsBetter: options.higherIsBetter ?? null,
      impact: options.higherIsBetter === true ? "worse" : "changed",
      color: options.higherIsBetter === true ? "red" : "neutral",
    };
  }

  if (baseNumeric !== null && targetNumeric !== null) {
    const delta = targetNumeric - baseNumeric;
    const percentDelta = baseNumeric === 0 ? null : (delta / Math.abs(baseNumeric)) * 100;
    const direction = delta > 0 ? "increase" : delta < 0 ? "decrease" : "unchanged";

    // "Close enough" band: tiny differences read as neutral (white) rather than
    // green/red, so a near-identical stat doesn't look like a meaningful swap.
    const tolerancePct = options.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
    const absFloor = options.absFloor ?? DEFAULT_ABS_FLOOR;
    const withinPct = percentDelta !== null && Math.abs(percentDelta) <= tolerancePct;
    const withinAbs = Math.abs(delta) <= absFloor;
    const near = delta !== 0 && (withinPct || withinAbs);

    let impact = delta === 0 || near ? "neutral" : "changed";
    if (!near && options.higherIsBetter === true) impact = delta > 0 ? "better" : delta < 0 ? "worse" : "neutral";
    if (!near && options.higherIsBetter === false) impact = delta < 0 ? "better" : delta > 0 ? "worse" : "neutral";
    const color = impact === "better" ? "green" : impact === "worse" ? "red" : "neutral";

    return {
      key,
      label: options.label ?? key,
      category: options.category ?? "stat",
      type: "numeric",
      baseValue: baseNumeric,
      targetValue: targetNumeric,
      baseRaw: displayValue(baseRaw),
      targetRaw: displayValue(targetRaw),
      delta,
      percentDelta,
      direction,
      changed: delta !== 0,
      near,
      status: delta === 0 ? "unchanged" : near ? "near" : "changed",
      higherIsBetter: options.higherIsBetter ?? null,
      impact,
      color,
    };
  }

  const changed = String(baseRaw ?? "") !== String(targetRaw ?? "");
  return {
    key,
    label: options.label ?? key,
    category: options.category ?? "stat",
    type: "text",
    baseValue: displayValue(baseRaw),
    targetValue: displayValue(targetRaw),
    delta: null,
    percentDelta: null,
    direction: changed ? "changed" : "unchanged",
    changed,
    status: changed ? "changed" : "unchanged",
    higherIsBetter: null,
    impact: changed ? "changed" : "neutral",
    color: "neutral",
  };
}

function countStatuses(rows) {
  return rows.reduce(
    (counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    },
    { added: 0, removed: 0, changed: 0, unchanged: 0 }
  );
}

function compareRecord(baseRecord = {}, targetRecord = {}, options = {}) {
  const baseByKey = new Map();
  const targetByKey = new Map();
  for (const [key, value] of Object.entries(baseRecord ?? {})) baseByKey.set(normalizeCompareKey(key), { key, value });
  for (const [key, value] of Object.entries(targetRecord ?? {})) targetByKey.set(normalizeCompareKey(key), { key, value });

  const rows = [...new Set([...baseByKey.keys(), ...targetByKey.keys()])]
    .sort((a, b) => {
      const left = baseByKey.get(a)?.key ?? targetByKey.get(a)?.key ?? a;
      const right = baseByKey.get(b)?.key ?? targetByKey.get(b)?.key ?? b;
      return left.localeCompare(right);
    })
    .map((normalizedKey) => {
      const base = baseByKey.get(normalizedKey);
      const target = targetByKey.get(normalizedKey);
      const label = target?.key ?? base?.key ?? normalizedKey;
      return compareValue(normalizedKey, base?.value, target?.value, { ...options, label });
    });

  return { rows, counts: countStatuses(rows), changed: rows.some((row) => row.changed) };
}

function snapshotMetadata(snapshot) {
  return {
    id: snapshot.id,
    label: snapshot.label,
    source: snapshot.source,
    createdAt: snapshot.createdAt,
    hash: snapshot.hash,
    sizeBytes: snapshot.sizeBytes,
    character: snapshot.summary?.character ?? {},
  };
}

function simplifySkill(skill = {}) {
  return {
    id: skill.id,
    label: skill.label,
    enabled: skill.enabled,
    mainActiveSkill: skill.mainActiveSkill,
    gems: (skill.gems ?? []).map((gem) => ({
      name: gem.name,
      level: gem.level,
      quality: gem.quality,
      enabled: gem.enabled,
      support: gem.support,
    })),
  };
}

function simplifyItem(item = {}) {
  return {
    id: item.id,
    slot: item.slot,
    name: item.name,
    typeLine: item.typeLine,
    rarity: item.rarity,
    itemLevel: item.itemLevel,
    quality: item.quality,
    sockets: item.sockets,
    mods: Array.isArray(item.mods) ? item.mods : [],
  };
}

function gemKey(gem = {}) {
  return normalizeCompareKey(gem.name || "");
}

// Per-gem comparison inside a skill group: which gems to add, drop, or relevel
// to match the build being copied.
function diffGems(baseGems = [], targetGems = []) {
  const baseByKey = new Map(baseGems.map((gem) => [gemKey(gem), gem]));
  const targetByKey = new Map(targetGems.map((gem) => [gemKey(gem), gem]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, gem] of targetByKey) {
    if (!baseByKey.has(key)) added.push(gem);
  }
  for (const [key, gem] of baseByKey) {
    if (!targetByKey.has(key)) removed.push(gem);
  }
  for (const [key, target] of targetByKey) {
    const base = baseByKey.get(key);
    if (!base) continue;
    // Discrete gem stats: a single level/quality point matters, so compare exactly.
    const level = compareValue("level", base.level, target.level, { label: "Level", higherIsBetter: true, tolerancePct: 0, absFloor: 0 });
    const quality = compareValue("quality", base.quality, target.quality, { label: "Quality", higherIsBetter: true, tolerancePct: 0, absFloor: 0 });
    if (level.changed || quality.changed) {
      changed.push({ name: target.name, base, target, level, quality });
    }
  }

  return {
    added,
    removed,
    changed,
    changedCount: added.length + removed.length + changed.length,
  };
}

// Collapse a mod line to a template by removing numeric rolls, so a re-rolled
// affix ("+45 to Life" vs "+52 to Life") reads as a roll change, not two mods.
function modTemplate(line) {
  return String(line || "").replace(/[+-]?\d+(?:\.\d+)?/g, "#").toLowerCase().trim();
}

// Per-item comparison for "changed" gear: property changes plus added / removed
// / re-rolled affixes, so the user can match a guide item piece by piece.
function diffItem(base = {}, target = {}) {
  const properties = [];
  const pushProp = (key, label, b, t, opts = {}) => {
    // Item properties are discrete (name, quality, ilvl, sockets) — compare exactly.
    const row = compareValue(key, b, t, { label, tolerancePct: 0, absFloor: 0, ...opts });
    if (row.changed) properties.push(row);
  };
  pushProp("name", "Name", base.name, target.name);
  pushProp("typeLine", "Base type", base.typeLine, target.typeLine);
  pushProp("quality", "Quality", base.quality, target.quality, { higherIsBetter: true });
  pushProp("itemLevel", "Item level", base.itemLevel, target.itemLevel, { higherIsBetter: true });
  pushProp("sockets", "Sockets", base.sockets, target.sockets);

  const baseMods = Array.isArray(base.mods) ? base.mods : [];
  const targetMods = Array.isArray(target.mods) ? target.mods : [];
  const baseByTemplate = new Map();
  const targetByTemplate = new Map();
  for (const mod of baseMods) if (!baseByTemplate.has(modTemplate(mod))) baseByTemplate.set(modTemplate(mod), mod);
  for (const mod of targetMods) if (!targetByTemplate.has(modTemplate(mod))) targetByTemplate.set(modTemplate(mod), mod);

  const modsAdded = [];
  const modsRemoved = [];
  const modsChanged = [];
  for (const [template, mod] of targetByTemplate) {
    if (!baseByTemplate.has(template)) modsAdded.push(mod);
    else if (baseByTemplate.get(template) !== mod) modsChanged.push({ from: baseByTemplate.get(template), to: mod });
  }
  for (const [template, mod] of baseByTemplate) {
    if (!targetByTemplate.has(template)) modsRemoved.push(mod);
  }

  return {
    properties,
    modsAdded,
    modsRemoved,
    modsChanged,
    changedCount: properties.length + modsAdded.length + modsRemoved.length + modsChanged.length,
  };
}

function signature(value) {
  return JSON.stringify(value ?? null);
}

function indexCollection(items, keyFn, simplifyFn) {
  const indexed = new Map();
  items.forEach((item, index) => {
    const key = keyFn(item, index);
    indexed.set(key, { key, value: simplifyFn(item), index });
  });
  return indexed;
}

function compareCollection(baseItems = [], targetItems = [], keyFn, simplifyFn) {
  const baseByKey = indexCollection(baseItems, keyFn, simplifyFn);
  const targetByKey = indexCollection(targetItems, keyFn, simplifyFn);
  const rows = [...new Set([...baseByKey.keys(), ...targetByKey.keys()])]
    .sort()
    .map((key) => {
      const base = baseByKey.get(key)?.value ?? null;
      const target = targetByKey.get(key)?.value ?? null;
      let status = "unchanged";
      if (!base) status = "added";
      else if (!target) status = "removed";
      else if (signature(base) !== signature(target)) status = "changed";
      return { key, status, changed: status !== "unchanged", base, target };
    });

  return { rows, counts: countStatuses(rows), changed: rows.some((row) => row.changed) };
}

function skillCompareKey(skill, index) {
  return normalizeCompareKey(skill?.id || skill?.label || skill?.mainActiveSkill || skill?.gems?.[0]?.name || `skill-${index + 1}`);
}

function itemCompareKey(item, index) {
  return normalizeCompareKey(item?.slot || item?.name || item?.typeLine || item?.id || `item-${index + 1}`);
}

function compareCharacter(baseCharacter = {}, targetCharacter = {}) {
  const fields = compareRecord(baseCharacter, targetCharacter, { category: "character" }).rows.map((row) => {
    if (row.key === "level") return compareValue(row.key, row.baseValue, row.targetValue, { label: row.label, category: "character", higherIsBetter: true });
    return row;
  });
  return { fields, counts: countStatuses(fields), changed: fields.some((field) => field.changed) };
}

function comparePassiveTree(baseTree = {}, targetTree = {}) {
  const baseIds = new Set(baseTree.allocatedNodeIds ?? []);
  const targetIds = new Set(targetTree.allocatedNodeIds ?? []);
  const addedNodeIds = [...targetIds].filter((id) => !baseIds.has(id)).sort();
  const removedNodeIds = [...baseIds].filter((id) => !targetIds.has(id)).sort();
  const sharedNodeIds = [...baseIds].filter((id) => targetIds.has(id)).sort();
  const allocatedNodeCount = compareValue(
    "allocatedNodeCount",
    baseTree.allocatedNodeCount ?? (baseIds.size || undefined),
    targetTree.allocatedNodeCount ?? (targetIds.size || undefined),
    { label: "Allocated nodes", category: "passiveTree" }
  );
  const treeVersion = compareValue("treeVersion", baseTree.treeVersion, targetTree.treeVersion, {
    label: "Tree version",
    category: "passiveTree",
  });
  const url = compareValue("url", baseTree.url, targetTree.url, { label: "Tree URL", category: "passiveTree" });

  // Enrich the id deltas with node names / stats from the bundled tree data, so
  // the UI can show "allocate Zealot's Oath (Energy Shield does not Recharge)"
  // rather than a bare node id. Prefer the target build's tree version.
  const treeIndex = resolveTreeIndex(targetTree.treeVersion || baseTree.treeVersion);
  const nodesToAllocate = describeNodes(addedNodeIds, treeIndex);
  const nodesToRemove = describeNodes(removedNodeIds, treeIndex);

  return {
    base: baseTree,
    target: targetTree,
    allocatedNodeCount,
    treeVersion,
    url,
    addedNodeIds,
    removedNodeIds,
    sharedNodeCount: sharedNodeIds.length,
    nodesToAllocate,
    nodesToRemove,
    treeDataVersion: treeIndex ? { version: treeIndex.version, exact: treeIndex.exact } : null,
    changed: allocatedNodeCount.changed || treeVersion.changed || url.changed || addedNodeIds.length > 0 || removedNodeIds.length > 0,
  };
}

// Attach per-gem detail to each changed skill row so the UI can show exactly
// which gems differ rather than the whole group as one blob.
function enrichSkillRows(comparison) {
  for (const row of comparison.rows) {
    if (row.status !== "changed") continue;
    row.gemDiff = diffGems(row.base?.gems, row.target?.gems);
  }
  return comparison;
}

// Attach per-mod / property detail to each changed item row.
function enrichItemRows(comparison) {
  for (const row of comparison.rows) {
    if (row.status !== "changed") continue;
    row.itemDiff = diffItem(row.base, row.target);
  }
  return comparison;
}

function compareSnapshots(baseSnapshot, targetSnapshot) {
  const character = compareCharacter(baseSnapshot.summary?.character, targetSnapshot.summary?.character);
  const defenses = compareRecord(baseSnapshot.summary?.defenses, targetSnapshot.summary?.defenses, {
    category: "defense",
    higherIsBetter: true,
  });
  const passiveTree = comparePassiveTree(baseSnapshot.summary?.passiveTree, targetSnapshot.summary?.passiveTree);
  const skills = enrichSkillRows(compareCollection(baseSnapshot.summary?.skills, targetSnapshot.summary?.skills, skillCompareKey, simplifySkill));
  const items = enrichItemRows(compareCollection(baseSnapshot.summary?.items, targetSnapshot.summary?.items, itemCompareKey, simplifyItem));

  return {
    base: snapshotMetadata(baseSnapshot),
    target: snapshotMetadata(targetSnapshot),
    character,
    skills,
    items,
    passiveTree,
    defenses: { stats: defenses.rows, counts: defenses.counts, changed: defenses.changed },
    statDiffs: defenses.rows,
  };
}



function buildSnapshotContext(snapshot) {
  if (!snapshot) return "No build snapshot is currently selected.";
  const lines = [
    `Snapshot: ${snapshot.label}`,
    `Source: ${snapshot.source}`,
    `Hash: ${snapshot.hash}`,
    `Payload kind: ${snapshot.summary.kind}`,
  ];
  const character = Object.entries(snapshot.summary.character).filter(([, value]) => value);
  if (character.length) lines.push(`Character: ${character.map(([key, value]) => `${key}=${value}`).join(", ")}`);
  if (snapshot.summary.skills.length) {
    lines.push("Skills:");
    for (const skill of snapshot.summary.skills.slice(0, 10)) {
      lines.push(`- ${skill.label}: ${skill.gems.map((gem) => [gem.name, gem.level ? `lvl ${gem.level}` : ""].filter(Boolean).join(" ")).join("; ")}`);
    }
  }
  if (snapshot.summary.items.length) {
    lines.push("Items:");
    for (const item of snapshot.summary.items.slice(0, 12)) {
      lines.push(`- ${[item.slot, item.name, item.typeLine].filter(Boolean).join(": ")}`);
    }
  }
  if (Object.keys(snapshot.summary.defenses).length) {
    lines.push(`Defense-like stats found: ${Object.entries(snapshot.summary.defenses).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  }
  if (snapshot.summary.detectedTerms.length) lines.push(`Detected terms: ${snapshot.summary.detectedTerms.join(", ")}`);
  if (snapshot.summary.warnings.length) lines.push(`Parser warnings: ${snapshot.summary.warnings.join(" | ")}`);
  return lines.join("\n");
}

function findRelevantSkills(snapshot, question) {
  const lowerQuestion = question.toLowerCase();
  return snapshot.summary.skills.filter((skill) => {
    const haystack = [skill.label, ...skill.gems.map((gem) => gem.name)].join(" ").toLowerCase();
    return haystack.split(/\s+/).some((token) => token.length > 3 && lowerQuestion.includes(token)) || lowerQuestion.includes("skill") || lowerQuestion.includes("gem");
  });
}

function buildLocalDemoResponse(snapshot, latestUserMessage) {
  if (!snapshot) {
    return [
      "PoBAI is running in local demo mode because no OpenRouter API key was provided.",
      "No build snapshot is selected yet. Import a fresh PoB XML export first, then ask your build question again.",
    ].join("\n\n");
  }

  const lowerQuestion = latestUserMessage.toLowerCase();
  const context = buildSnapshotContext(snapshot);
  const sections = [
    "PoBAI is running in local demo mode because no OpenRouter API key was provided.",
    "Here is what I can ground from the imported snapshot right now:",
    context,
  ];

  if (lowerQuestion.includes("defen") || lowerQuestion.includes("surviv") || lowerQuestion.includes("ehp") || lowerQuestion.includes("low")) {
    const defenses = Object.entries(snapshot.summary.defenses);
    sections.push("Defense answer: I can only use defense-like values that were exported into the XML. Exact mitigation/eHP requires the PoB/MCP calculation bridge. If the defense list above is sparse or empty, the next step is connecting PoB calculations rather than guessing.");
    if (defenses.length) {
      sections.push(`Extracted defense-like stats: ${defenses.map(([key, value]) => `${key}: ${value}`).join(", ")}. Review uncapped resistances, life/ES pool, armour/evasion/block layers, and recovery once PoB calcs are available.`);
    }
  } else if (lowerQuestion.includes("twister") || lowerQuestion.includes("trinity") || lowerQuestion.includes("fire") || lowerQuestion.includes("cold") || lowerQuestion.includes("lightning")) {
    const relevantSkills = findRelevantSkills(snapshot, latestUserMessage);
    sections.push("Skill/damage answer: I can list extracted skill groups and gems, but I cannot truthfully calculate Twister's fire/cold/lightning split until PoB/MCP calculation tools are connected.");
    if (relevantSkills.length) {
      sections.push(`Relevant extracted skill groups: ${relevantSkills.slice(0, 5).map((skill) => `${skill.label} (${skill.gems.map((gem) => gem.name).join(", ")})`).join(" | ")}.`);
    }
  } else {
    sections.push("General answer: I can summarize imported XML facts locally. For exact optimization, support compatibility, damage conversion, and passive/item what-if testing, PoBAI still needs the planned poe2-mcp/PoB bridge integration.");
  }

  if (snapshot.summary.warnings.length) {
    sections.push(`Important parser limitations: ${snapshot.summary.warnings.join(" ")}`);
  }

  return sections.join("\n\n");
}


function classifyQuestion(question = "") {
  const lower = question.toLowerCase();
  if (lower.includes("defen") || lower.includes("surviv") || lower.includes("ehp") || lower.includes("resist") || lower.includes("mitigation")) return "defense";
  if (lower.includes("twister") || lower.includes("trinity") || lower.includes("damage") || lower.includes("fire") || lower.includes("cold") || lower.includes("lightning")) return "skill_damage";
  if (lower.includes("support") || lower.includes("gem")) return "gem_support";
  if (lower.includes("item") || lower.includes("weapon") || lower.includes("gear")) return "item";
  if (lower.includes("passive") || lower.includes("tree") || lower.includes("node")) return "passive_tree";
  return "general";
}

function buildEvidence(snapshot, question = "") {
  if (!snapshot) {
    return {
      questionType: classifyQuestion(question),
      extracted: [],
      unavailable: ["No snapshot selected"],
      warnings: [],
    };
  }

  const extracted = [];
  const unavailable = [
    "Exact DPS and elemental damage split",
    "Exact eHP and mitigation calculations",
    "Support compatibility validation",
    "Passive/item what-if simulation",
  ];

  const character = Object.entries(snapshot.summary.character).filter(([, value]) => value);
  if (character.length) extracted.push(`Character: ${character.map(([key, value]) => `${key}=${value}`).join(", ")}`);
  if (snapshot.summary.skills.length) extracted.push(`Skill groups parsed: ${snapshot.summary.skills.length}`);
  if (snapshot.summary.items.length) extracted.push(`Items parsed: ${snapshot.summary.items.length}`);
  if (Object.keys(snapshot.summary.defenses).length) extracted.push(`Defense-like stats: ${Object.entries(snapshot.summary.defenses).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  if (snapshot.summary.passiveTree.allocatedNodeCount) extracted.push(`Passive nodes parsed: ${snapshot.summary.passiveTree.allocatedNodeCount}`);
  if (snapshot.summary.detectedTerms.length) extracted.push(`Detected terms: ${snapshot.summary.detectedTerms.join(", ")}`);

  return {
    questionType: classifyQuestion(question),
    extracted,
    unavailable,
    warnings: snapshot.summary.warnings,
  };
}

const LOCAL_TOOL_NAMES = new Set([
  "list_builds", "get_build_summary", "get_skills",
  "get_items", "get_defenses", "get_passive_tree",
]);

const POBAI_BRIDGE_TOOL_NAMES = new Set([
  "pob2_get_calcs", "pob2_export_build",
  "pob2_test_gem_swap", "pob2_test_item_swap", "pob2_test_passive_change",
]);

/** Merge our local tools with PoB2 bridge tools and whatever poe2-mcp has connected. */
function getToolDefinitions() {
  return [...BASE_TOOL_DEFINITIONS, ...poe2Mcp.toLlmToolDefinitions()];
}

const BASE_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "list_builds",
      description: "List all imported PoB2 builds in this session.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_build_summary",
      description: "Get a complete summary of an imported build: character, skills, items, defenses, and passive tree.",
      parameters: {
        type: "object",
        properties: {
          snapshot_id: { type: "string", description: "The snapshot ID from list_builds or the import response." },
        },
        required: ["snapshot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skills",
      description: "Get all skill groups and gems from an imported build.",
      parameters: {
        type: "object",
        properties: {
          snapshot_id: { type: "string", description: "The snapshot ID." },
        },
        required: ["snapshot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_items",
      description: "Get equipped items from an imported build. Optionally filter by slot name.",
      parameters: {
        type: "object",
        properties: {
          snapshot_id: { type: "string", description: "The snapshot ID." },
          slot: { type: "string", description: "Optional slot filter (e.g. 'Weapon 1', 'Helm'). Case-insensitive partial match." },
        },
        required: ["snapshot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_defenses",
      description: "Get defense statistics from an imported build: life, energy shield, resistances, armour, evasion, block.",
      parameters: {
        type: "object",
        properties: {
          snapshot_id: { type: "string", description: "The snapshot ID." },
        },
        required: ["snapshot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_passive_tree",
      description: "Get passive tree info for an imported build. Returns tree URL, version, node count, and all allocated node IDs (usable with poe2-mcp inspect_passive_node).",
      parameters: {
        type: "object",
        properties: {
          snapshot_id: { type: "string", description: "The snapshot ID." },
        },
        required: ["snapshot_id"],
      },
    },
  },
  // --- PoB2 live bridge tools ---
  {
    type: "function",
    function: {
      name: "pob2_get_calcs",
      description: "Get the current PoB2 build's exact calculated stats (CombinedDPS, Life, Energy Shield, Armour, Evasion, LifeRegenRecovery, Minion DPS, etc.). Requires the PoB2 bridge to be connected and PoB2 running.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "pob2_export_build",
      description: "Export the current PoB2 build as full XML and export code. Returns the raw build data, build name, and current calculated stats. Use this first to get the current state before making modifications.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "pob2_test_gem_swap",
      description: "Test swapping a gem by importing a full modified PoB2 build XML document. Do not pass partial <Skill> XML; the current bridge imports whole builds and may replace the active PoB2 build until you restore the original XML.",
      parameters: {
        type: "object",
        properties: {
          build_xml: { type: "string", description: "Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with the swapped gem(s) already applied" },
          slot_name: { type: "string", description: "Which skill group slot was modified (e.g. 'Skill 1')" },
        },
        required: ["build_xml", "slot_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pob2_test_item_swap",
      description: "Test replacing an item by importing a full modified PoB2 build XML document. Do not pass partial <Item> XML; the current bridge imports whole builds and may replace the active PoB2 build until you restore the original XML.",
      parameters: {
        type: "object",
        properties: {
          build_xml: { type: "string", description: "Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with the replacement item already applied" },
          slot: { type: "string", description: "Equipment slot being replaced (e.g. 'Weapon 1', 'Helm', 'Body Armour')" },
        },
        required: ["build_xml", "slot"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pob2_test_passive_change",
      description: "Test passive tree changes by importing a full modified PoB2 build XML document. Do not pass partial passive fragments; the current bridge imports whole builds and may replace the active PoB2 build until you restore the original XML.",
      parameters: {
        type: "object",
        properties: {
          build_xml: { type: "string", description: "Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with modified passive tree nodes already applied" },
          note: { type: "string", description: "Optional description of what nodes were changed" },
        },
        required: ["build_xml"],
      },
    },
  },
];

function executeLocalTool(name, args) {
  if (name === "list_builds") {
    return [...snapshots.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        snapshot_id: s.id,
        label: s.label,
        source: s.source,
        created_at: s.createdAt,
        character: s.summary?.character ?? {},
      }));
  }

  const snap = args?.snapshot_id ? snapshots.get(args.snapshot_id) : undefined;

  if (name === "get_build_summary") {
    if (!snap) return { error: `No build found with snapshot_id: ${args?.snapshot_id}` };
    return {
      snapshot_id: snap.id,
      label: snap.label,
      character: snap.summary.character,
      skills: snap.summary.skills,
      items: snap.summary.items,
      defenses: snap.summary.defenses,
      passive_tree: snap.summary.passiveTree,
      detected_terms: snap.summary.detectedTerms,
      warnings: snap.summary.warnings,
    };
  }

  if (name === "get_skills") {
    if (!snap) return { error: `No build found with snapshot_id: ${args?.snapshot_id}` };
    return { skills: snap.summary.skills };
  }

  if (name === "get_items") {
    if (!snap) return { error: `No build found with snapshot_id: ${args?.snapshot_id}` };
    const items = args?.slot
      ? snap.summary.items.filter((i) => i.slot?.toLowerCase().includes(args.slot.toLowerCase()))
      : snap.summary.items;
    return { items, slot_filter: args?.slot ?? null };
  }

  if (name === "get_defenses") {
    if (!snap) return { error: `No build found with snapshot_id: ${args?.snapshot_id}` };
    return {
      defenses: snap.summary.defenses,
      note: Object.keys(snap.summary.defenses).length === 0
        ? "No defense stats in XML — exact values require PoB2 calculation bridge."
        : "Extracted from PoB2 XML. Exact eHP/mitigation needs PoB2 calculation bridge.",
      warnings: snap.summary.warnings.filter((w) => w.includes("defense")),
    };
  }

  if (name === "get_passive_tree") {
    if (!snap) return { error: `No build found with snapshot_id: ${args?.snapshot_id}` };
    return snap.summary.passiveTree;
  }

  return null; // not a local tool
}

async function callBridge(action, body) {
  try {
    const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(body || {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `PoB2 bridge returned HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { error: `PoB2 bridge not reachable: ${err?.message ?? err}` };
  }
}

function isFullPob2BuildXml(xml) {
  return typeof xml === "string" &&
    /<\s*PathOfBuilding2(?:\s|>)/i.test(xml) &&
    /<\s*Build(?:\s|\/|>)/i.test(xml);
}

function fullBuildXmlToolError() {
  return {
    error:
      "build_xml must be a full PoB2 XML export containing <PathOfBuilding2> and <Build>. " +
      "Partial <Skill>, <Item>, or passive fragments are rejected because the current bridge imports whole builds and does not patch fragments safely.",
  };
}

async function executeTool(name, args) {
  if (LOCAL_TOOL_NAMES.has(name)) {
    return executeLocalTool(name, args);
  }

  // PoB2 bridge tools — forward to PoB2's Lua HTTP listener
  if (POBAI_BRIDGE_TOOL_NAMES.has(name)) {
    if (name === "pob2_get_calcs") {
      const data = await callBridge("get_calcs");
      if (data.error) return data;
      return { stats: data.stats };
    }

    if (name === "pob2_export_build") {
      return await callBridge("export_build");
    }

    if (name === "pob2_test_gem_swap") {
      if (!isFullPob2BuildXml(args?.build_xml)) return fullBuildXmlToolError();
      const data = await callBridge("import_build", {
        xml: args.build_xml,
      });
      if (data.error) return data;
      return {
        status: "tested",
        note: `Tested gem swap in slot "${args?.slot_name || "unknown"}"`,
        stats: data.stats,
      };
    }

    if (name === "pob2_test_item_swap") {
      if (!isFullPob2BuildXml(args?.build_xml)) return fullBuildXmlToolError();
      const data = await callBridge("import_build", {
        xml: args.build_xml,
      });
      if (data.error) return data;
      return {
        status: "tested",
        note: `Tested item swap in slot "${args?.slot || "unknown"}"`,
        stats: data.stats,
      };
    }

    if (name === "pob2_test_passive_change") {
      if (!isFullPob2BuildXml(args?.build_xml)) return fullBuildXmlToolError();
      const data = await callBridge("import_build", {
        xml: args.build_xml,
      });
      if (data.error) return data;
      return {
        status: "tested",
        note: args?.note || "Tested passive tree change",
        stats: data.stats,
      };
    }
  }

  if (poe2Mcp.ready) {
    try {
      return await poe2Mcp.callTool(name, args);
    } catch (error) {
      return { error: `poe2-mcp tool "${name}" failed: ${error.message}` };
    }
  }
  return {
    error: `Tool "${name}" requires poe2-mcp which is not connected. ` +
      `Install with: pip install poe2-mcp, then restart the PoBAI server.`,
  };
}

async function serveStatic(request, response, url) {
  let requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === "/") requestedPath = "/index.html";

  const candidate = normalize(join(webRoot, requestedPath));
  if (!candidate.startsWith(webRoot)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const filePath = existsSync(candidate) ? candidate : join(webRoot, "index.html");
  const extension = extname(filePath);
  response.writeHead(200, { "content-type": mimeTypes.get(extension) ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "pobai-server", version: "0.3.0" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    let pob2Connected = false;
    try {
      const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
        signal: AbortSignal.timeout(2000),
      });
      pob2Connected = res.ok;
    } catch {}
    sendJson(response, 200, {
      ok: true,
      buildsLoaded: snapshots.size,
      poe2Mcp: {
        connected: poe2Mcp.ready,
        toolCount: poe2Mcp.tools.length,
        tools: poe2Mcp.toolNames,
      },
      pob2Bridge: { connected: pob2Connected, url: POB2_BRIDGE_URL },
      localTools: [...LOCAL_TOOL_NAMES, ...POBAI_BRIDGE_TOOL_NAMES],
      allTools: [...LOCAL_TOOL_NAMES, ...POBAI_BRIDGE_TOOL_NAMES, ...poe2Mcp.toolNames],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/build/current") {
    sendJson(response, 200, { snapshots: [...snapshots.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/builds") {
    const builds = [...snapshots.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) // oldest first, stable across restarts
      .map((s) => ({
        snapshot_id: s.id,
        label: s.label,
        source: s.source,
        created_at: s.createdAt,
        character: s.summary?.character,
      }));
    sendJson(response, 200, builds);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/build/compare") {
    const body = await readJson(request);
    const error = validateComparePayload(body);
    if (error) {
      sendJson(response, 400, { error });
      return;
    }

    const baseId = body.baseId.trim();
    const targetId = body.targetId.trim();
    const baseSnapshot = snapshots.get(baseId);
    const targetSnapshot = snapshots.get(targetId);
    const missingIds = [
      ...(baseSnapshot ? [] : [baseId]),
      ...(targetSnapshot ? [] : [targetId]),
    ];

    if (missingIds.length > 0) {
      sendJson(response, 404, { error: "Snapshot not found", missingIds });
      return;
    }

    sendJson(response, 200, compareSnapshots(baseSnapshot, targetSnapshot));
    return;
  }

  const snapshotMatch = url.pathname.match(/^\/api\/build\/([^/]+)\/summary$/);
  if (request.method === "GET" && snapshotMatch) {
    const snapshot = snapshots.get(snapshotMatch[1]);
    if (!snapshot) {
      sendJson(response, 404, { error: "Snapshot not found" });
      return;
    }
    sendJson(response, 200, { snapshot });
    return;
  }

  const skillsMatch = url.pathname.match(/^\/api\/build\/([^/]+)\/skills$/);
  if (request.method === "GET" && skillsMatch) {
    const sid = skillsMatch[1];
    const snap = snapshots.get(sid);
    if (!snap) {
      sendJson(response, 404, { error: "Build not found" });
      return;
    }
    sendJson(response, 200, { skills: snap.summary?.skills || [] });
    return;
  }

  const itemsMatch = url.pathname.match(/^\/api\/build\/([^/]+)\/items$/);
  if (request.method === "GET" && itemsMatch) {
    const sid = itemsMatch[1];
    const snap = snapshots.get(sid);
    if (!snap) {
      sendJson(response, 404, { error: "Build not found" });
      return;
    }
    sendJson(response, 200, { items: snap.summary?.items || [] });
    return;
  }

  const treeMatch = url.pathname.match(/^\/api\/build\/([^/]+)\/passive-tree$/);
  if (request.method === "GET" && treeMatch) {
    const sid = treeMatch[1];
    const snap = snapshots.get(sid);
    if (!snap) {
      sendJson(response, 404, { error: "Build not found" });
      return;
    }
    sendJson(response, 200, snap.summary?.passiveTree || {});
    return;
  }

  const defMatch = url.pathname.match(/^\/api\/build\/([^/]+)\/defenses$/);
  if (request.method === "GET" && defMatch) {
    const sid = defMatch[1];
    const snap = snapshots.get(sid);
    if (!snap) {
      sendJson(response, 404, { error: "Build not found" });
      return;
    }
    sendJson(response, 200, { defenses: snap.summary?.defenses || {} });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/build\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const snapshot = snapshots.get(deleteMatch[1]);
    if (!snapshot) {
      sendJson(response, 404, { error: "Snapshot not found" });
      return;
    }
    await deleteSnapshot(snapshot.id);
    sendJson(response, 200, { deleted: true, id: snapshot.id });
    return;
  }

  // --- PoB2 bridge proxy endpoints ---
  if (request.method === "GET" && url.pathname === "/api/pob2/status") {
    try {
      const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
        signal: AbortSignal.timeout(3000),
      });
      const data = res.ok ? await res.json() : null;
      sendJson(response, 200, { connected: res.ok, version: data?.version ?? null });
    } catch {
      sendJson(response, 200, { connected: false, version: null });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/pob2/export") {
    try {
      const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export_build" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        sendJson(response, 502, { error: `Bridge returned HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      sendJson(response, 200, data);
    } catch (err) {
      sendJson(response, 502, { error: `PoB2 bridge not reachable: ${err?.message ?? err}` });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/pob2/calculate") {
    const body = await readJson(request);
    if (!body.xml) {
      sendJson(response, 400, { error: "xml field is required" });
      return;
    }
    try {
      const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calculate", xml: body.xml }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        sendJson(response, 502, { error: `Bridge calculation returned HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      sendJson(response, 200, data);
    } catch (err) {
      sendJson(response, 502, { error: `PoB2 bridge not reachable: ${err?.message ?? err}` });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/build/import") {
    const body = await readJson(request);
    const error = validateImportPayload(body);
    if (error) {
      sendJson(response, 400, { error });
      return;
    }

    const importPayload = typeof body.payload === "string" ? body.payload : body.code;
    const rawPayload = importPayload.replace(/\r\n/g, "\n").trim();
    let resolved;
    try {
      resolved = await resolveToXml(rawPayload, { mcp: poe2Mcp });
    } catch (err) {
      if (err instanceof ImportError) {
        sendJson(response, 422, { error: err.message });
        return;
      }
      sendJson(response, 500, { error: err instanceof Error ? err.message : "Import failed." });
      return;
    }

    const xml = resolved.xml;
    const hash = createHash("sha256").update(xml).digest("hex");
    const summary = parseBuild(xml).summary;
    if (resolved.note) summary.resolvedFrom = resolved.note;
    const snapshot = {
      id: randomUUID(),
      source: body.source,
      createdAt: new Date().toISOString(),
      label: body.label?.trim() || `${body.source} snapshot ${new Date().toISOString()}`,
      hash,
      sizeBytes: Buffer.byteLength(xml, "utf8"),
      preview: xml.slice(0, 240),
      summary,
    };

    snapshots.set(snapshot.id, snapshot);
    payloads.set(snapshot.id, xml);
    await persistSnapshot(snapshot, xml);
    sendJson(response, 201, { snapshot });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(request);
    const error = validateChatPayload(body);
    if (error) {
      sendJson(response, 400, { error });
      return;
    }

    const latestUserMessage = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

    // Demo mode — no API key: execute tools directly and return formatted response
    if (!body.apiKey || !body.apiKey.trim()) {
      const snapshot = body.snapshotId ? snapshots.get(body.snapshotId) : undefined;
      const toolTrace = [];
      if (snapshot) {
        const defResult = await executeTool("get_defenses", { snapshot_id: snapshot.id });
        toolTrace.push({ tool: "get_defenses", args: { snapshot_id: snapshot.id }, result: defResult });
        const skillResult = await executeTool("get_skills", { snapshot_id: snapshot.id });
        toolTrace.push({ tool: "get_skills", args: { snapshot_id: snapshot.id }, result: skillResult });
      } else {
        const listResult = await executeTool("list_builds", {});
        toolTrace.push({ tool: "list_builds", args: {}, result: listResult });
      }
      sendJson(response, 200, {
        message: {
          id: randomUUID(),
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: buildLocalDemoResponse(snapshot, latestUserMessage),
          toolTrace,
        },
      });
      return;
    }

    // Live mode — tool-use loop with the configured LLM
    let pob2BridgeConnected = false;
    try {
      const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
        signal: AbortSignal.timeout(2000),
      });
      pob2BridgeConnected = res.ok;
    } catch {}

    const poe2McpStatus = poe2Mcp.ready
      ? `poe2-mcp is CONNECTED with ${poe2Mcp.tools.length} live game tools: ${poe2Mcp.toolNames.slice(0, 8).join(", ")}...`
      : "poe2-mcp is NOT connected (pip install poe2-mcp needed). You only have the 6 local PoB parse tools.";

    const pob2BridgeStatus = pob2BridgeConnected
      ? "PoB2 bridge is CONNECTED — you can read live DPS/eHP from PoB2 and test modifications."
      : "PoB2 bridge is NOT connected — you cannot read live PoB2 calc data. Use the imported snapshot tools instead.";

    const systemPrompt = [
      "You are PoBAI, a Path of Exile 2 build advisor with direct access to the player's imported build data and live game knowledge tools.",
      "",
      `Tool status: ${poe2McpStatus}`,
      `PoB2 bridge: ${pob2BridgeStatus}`,
      "",
      "## Workflow for EVERY new conversation:",
      "1. Call get_build_summary(snapshot_id) first to load the player's build. The snapshot_id comes from the user context or list_builds.",
      "2. Briefly confirm what you found: character name, class, ascendancy, level, key skills, passive node count.",
      "3. Only then answer the user's question using real tool data.",
      "",
      "## For damage questions (e.g. 'what does my Twister do?', 'how much DPS?'):",
      "1. get_skills → identify the skill and all socketed support gems.",
      "2. get_items → find gear affecting that skill (weapon, body armour, helmet enchants).",
      "3. get_passive_tree → get passive node IDs; if poe2-mcp is connected, call analyze_passive_tree(node_ids) or inspect_passive_node / inspect_keystone for relevant nodes.",
      "4. If poe2-mcp connected: inspect_spell_gem(spell_name) and inspect_support_gem(support_name) for base values and tags, and validate_support_combination to confirm the links are legal. poe2-mcp is a DATA layer — it has no single 'calculate DPS' tool.",
      "5. Compute DPS/eHP yourself from those base values using PoE2 mechanics (use explain_mechanic for exact interactions). Show your inputs and the math; never invent numbers without tool data.",
      "",
      "## For optimization requests (e.g. 'balance Trinity resonance', 'improve my DPS'):",
      "1. First understand the current state completely (skills, supports, passives, gear).",
      "2. Identify the specific constraint (e.g. Trinity needs equal fire/cold/lightning added damage).",
      "3. If poe2-mcp connected: try alternatives — swap gems, recalculate, compare. Show before/after.",
       "4. If poe2-mcp not connected: explain what changes to make and why, but flag that you can't recalculate without poe2-mcp.",
      "5. Give concrete, actionable recommendations: exact gem names, passive nodes to allocate/deallocate, specific items to target.",
      "",
      "## When the PoB2 bridge is connected (live PoB2 calc access):",
      "1. Call pob2_get_calcs to read current DPS/eHP before giving advice.",
      "2. For 'what if' questions: pob2_export_build → modify XML → pob2_test_gem_swap / pob2_test_item_swap → compare results.",
      "3. Cite exact deltas: 'Swapping to Fire Penetration changes CombinedDPS from 245,000 to 312,000 (+27%).'",
      "4. After testing a modification, the build state in PoB2 has changed. Test one change at a time.",
      "",
      "## Rules:",
      "- NEVER invent DPS numbers, resistance percentages, or mechanic interactions — always use tool data.",
      "- If the user gives a poe.ninja profile URL (or an account + character name) and poe2-mcp is connected, use import_poe_ninja_url or analyze_character to pull their live build.",
      "- If poe2-mcp tools would give a better answer but aren't connected, say so clearly.",
      "- Be specific: name exact gems, nodes by name, items by name and mod values.",
      "- For multi-step optimization, show your reasoning step by step.",
      "- If the player asks about a mechanic you're unsure of, say so rather than guessing.",
    ].join("\n");

    const conversationMessages = [{ role: "system", content: systemPrompt }, ...body.messages];
    const toolTrace = [];
    let remainingIter = 8;

    while (remainingIter-- > 0) {
      let llmResponse;
      try {
        llmResponse = await fetch(`${openRouterBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${body.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? `http://localhost:${port}`,
            "X-Title": "PoBAI",
          },
          body: JSON.stringify({
            model: body.model,
            messages: conversationMessages,
            tools: getToolDefinitions(),
            tool_choice: "auto",
          }),
        });
      } catch (fetchError) {
        sendJson(response, 502, { error: "Could not reach LLM API", detail: fetchError instanceof Error ? fetchError.message : String(fetchError) });
        return;
      }

      if (!llmResponse.ok) {
        sendJson(response, llmResponse.status, { error: "LLM request failed", detail: await llmResponse.text() });
        return;
      }

      const data = await llmResponse.json();
      const choice = data.choices?.[0];
      if (!choice) {
        sendJson(response, 500, { error: "LLM returned no choices" });
        return;
      }

      const assistantMsg = choice.message;

      if (choice.finish_reason === "tool_calls" || assistantMsg.tool_calls?.length > 0) {
        conversationMessages.push(assistantMsg);
        for (const toolCall of assistantMsg.tool_calls ?? []) {
          let toolArgs;
          try { toolArgs = JSON.parse(toolCall.function.arguments ?? "{}"); } catch { toolArgs = {}; }

          const toolResult = await executeTool(toolCall.function.name, toolArgs);
          toolTrace.push({ tool: toolCall.function.name, args: toolArgs, result: toolResult });
          conversationMessages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) });
        }
      } else {
        sendJson(response, 200, {
          message: {
            id: randomUUID(),
            role: "assistant",
            content: assistantMsg.content ?? "No response.",
            createdAt: new Date().toISOString(),
            toolTrace,
          },
        });
        return;
      }
    }

    sendJson(response, 200, {
      message: {
        id: randomUUID(),
        role: "assistant",
        content: "I hit the tool call limit without reaching a final answer. Try asking a more specific question.",
        createdAt: new Date().toISOString(),
        toolTrace,
      },
    });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected server error" });
  }
});

await loadSnapshotsFromDisk();

server.listen(port, host, async () => {
  console.log(`pobai-server listening on http://${host}:${port}`);
  try {
    await poe2Mcp.connect();
    console.log(`poe2-mcp connected: ${poe2Mcp.toolNames.length} tools`);
  } catch (e) {
    console.log("poe2-mcp not available, continuing without bridge tools");
  }
});
