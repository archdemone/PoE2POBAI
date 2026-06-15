import { createHash, randomUUID } from "node:crypto";
import { inflateSync, inflateRawSync } from "node:zlib";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Poe2McpClient } from "./poe2-mcp-client.mjs";

// PORT is set by Render/Railway; POBAI_SERVER_PORT is the local dev override
const port = Number(process.env.PORT ?? process.env.POBAI_SERVER_PORT ?? 3001);
const host = process.env.POBAI_SERVER_HOST ?? "0.0.0.0";
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

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

async function getPayload(snapshotId) {
  if (payloads.has(snapshotId)) return payloads.get(snapshotId);
  const payload = await readFile(payloadPath(snapshotId), "utf8");
  payloads.set(snapshotId, payload);
  return payload;
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
  if (typeof body.payload !== "string" || body.payload.trim().length === 0) return "payload is required.";
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

function decodeXml(value = "") {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(text = "") {
  const attributes = {};
  for (const match of text.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function firstTagAttributes(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}\\b([^>]*)>`, "i"));
  return match ? parseAttributes(match[1]) : {};
}

function collectTagAttributes(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b([^>]*)/?>`, "gi"))].map((match) => parseAttributes(match[1]));
}

function collectBlocks(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)</${tagName}>`, "gi"))].map((match) => ({
    attributes: parseAttributes(match[1]),
    body: match[2],
  }));
}

function textFromTag(body, tagName) {
  const match = body.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]*>/g, "").trim()) : "";
}

function compact(value) {
  return value === undefined || value === null || value === "" ? undefined : value;
}

function inferPayloadKind(payload) {
  if (/^\s*</.test(payload) && /PathOfBuilding/i.test(payload)) return "pob-xml";
  if (/^https?:\/\//i.test(payload)) return "url";
  return "opaque-code";
}

/** Thrown when an import payload can't be resolved; carries a user-facing message. */
class ImportError extends Error {}

// PoB export codes are URL-safe base64 of zlib-compressed XML.
// Try zlib (RFC 1950) first, then raw deflate as a fallback.
function decodePobCode(code) {
  const normalized = code.trim().replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(normalized, "base64");
  try {
    return inflateSync(buf).toString("utf8");
  } catch {
    return inflateRawSync(buf).toString("utf8");
  }
}

function looksLikePobXml(text) {
  return /^\s*</.test(text) && /PathOfBuilding/i.test(text);
}

function looksLikeUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

// Pull the longest decodable PoB code out of arbitrary text (e.g. an HTML page).
function extractEmbeddedPobXml(text) {
  const candidates = text.match(/[A-Za-z0-9\-_+/=]{120,}/g);
  if (!candidates) return null;
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      const xml = decodePobCode(candidate);
      if (looksLikePobXml(xml)) return xml;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// Map known build-share hosts to the endpoint that returns the raw PoB code.
function toRawBuildUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  if (host === "pobb.in" && !/\/raw$/.test(path)) {
    const id = path.replace(/^\/+/, "");
    if (id) return `https://pobb.in/${id}/raw`;
  }
  if (host === "pastebin.com") {
    const match = path.match(/^\/(?:raw\/)?([A-Za-z0-9]+)$/);
    if (match) return `https://pastebin.com/raw/${match[1]}`;
  }
  return parsed.toString();
}

async function fetchBuildUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "PoBAI/0.3", accept: "text/plain, application/xml, text/html, */*" },
    });
    if (!res.ok) throw new ImportError(`The build URL returned HTTP ${res.status}.`);
    return await res.text();
  } catch (err) {
    if (err instanceof ImportError) throw err;
    const reason = err?.name === "AbortError" ? "the request timed out" : err?.message ?? "unknown error";
    throw new ImportError(`Could not fetch the build URL (${reason}).`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve any supported import payload to PoB2 XML, fetching URLs and
 * decompressing export codes as needed. Returns { xml, note? }; throws
 * ImportError with a user-facing message when it can't be resolved.
 */
async function resolveToXml(rawPayload) {
  const payload = rawPayload.trim();

  // 1. Raw PoB2 XML — use as-is.
  if (looksLikePobXml(payload)) return { xml: payload };

  // 2. Build URL — fetch and resolve its contents.
  if (looksLikeUrl(payload)) {
    const fetchUrl = toRawBuildUrl(payload);
    const body = (await fetchBuildUrl(fetchUrl)).trim();
    if (looksLikePobXml(body)) return { xml: body, note: `Imported XML from ${fetchUrl}` };
    if (!looksLikeUrl(body) && !body.startsWith("<")) {
      try {
        const xml = decodePobCode(body);
        if (looksLikePobXml(xml)) return { xml, note: `Imported PoB code from ${fetchUrl}` };
      } catch { /* fall through to embedded scan */ }
    }
    const embedded = extractEmbeddedPobXml(body);
    if (embedded) return { xml: embedded, note: `Extracted embedded PoB code from ${fetchUrl}` };
    throw new ImportError(
      "Fetched the URL but found no Path of Building code in it. " +
      'poe.ninja build pages load their data dynamically — open the build, use "Copy" / "Export to Path of Building", ' +
      "and paste that code here instead. Direct pobb.in and pastebin links work."
    );
  }

  // 3. Opaque text — try to decompress it as a PoB export code.
  try {
    const xml = decodePobCode(payload);
    if (looksLikePobXml(xml)) return { xml };
  } catch { /* fall through */ }

  throw new ImportError(
    "This doesn't look like a PoB2 export code, XML, or a build URL. " +
    'In Path of Building 2 use Import/Export → "Generate" to copy an export code, then paste it here.'
  );
}

function parseBuildSummary(payload, source) {
  const kind = inferPayloadKind(payload);
  const warnings = [];
  const summary = {
    kind,
    character: {},
    skills: [],
    items: [],
    passiveTree: {},
    defenses: {},
    detectedTerms: [],
    warnings,
  };

  if (kind !== "pob-xml") {
    warnings.push("Payload is not recognizable XML, so PoBAI stored metadata only. Paste a PoB XML export for local parsing before MCP is connected.");
    if (source === "poe-ninja" || kind === "url") warnings.push("URL import resolution is planned for the MCP integration milestone.");
    return summary;
  }

  const build = firstTagAttributes(payload, "Build");
  const player = firstTagAttributes(payload, "Player");
  const spec = firstTagAttributes(payload, "Spec");
  summary.character = {
    name: compact(build.characterName || build.name || player.name),
    className: compact(build.className || build.class || player.className || player.class),
    ascendancy: compact(build.ascendClassName || build.ascendancyName || spec.ascendClassName),
    level: compact(build.level || player.level),
    league: compact(build.league || player.league),
  };

  const statCandidates = [
    ...collectTagAttributes(payload, "PlayerStat"),
    ...collectTagAttributes(payload, "Stat"),
    ...collectTagAttributes(payload, "Mod"),
  ];
  const defenseKeys = ["life", "energyshield", "energy_shield", "es", "armour", "armor", "evasion", "block", "fire", "cold", "lightning", "chaos", "resistance", "resist"];
  for (const stat of statCandidates) {
    const key = String(stat.stat || stat.name || stat.id || "").toLowerCase();
    const value = compact(stat.value || stat.val || stat.total || stat.amount);
    if (!key || value === undefined) continue;
    if (defenseKeys.some((defenseKey) => key.includes(defenseKey))) {
      summary.defenses[stat.stat || stat.name || stat.id] = value;
    }
  }

  const itemBlocks = collectBlocks(payload, "Item");
  summary.items = itemBlocks.slice(0, 80).map((item, index) => {
    const rawText = decodeXml(item.body.replace(/<[^>]+>/g, "\n")).split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      id: compact(item.attributes.id || item.attributes.itemId || String(index + 1)),
      slot: compact(item.attributes.slot || item.attributes.inventoryId || item.attributes.location),
      name: compact(textFromTag(item.body, "Name") || item.attributes.name || rawText[0]),
      typeLine: compact(textFromTag(item.body, "TypeLine") || item.attributes.typeLine || rawText[1]),
      rarity: compact(item.attributes.rarity),
    };
  }).filter((item) => item.name || item.typeLine || item.slot);

  const skillBlocks = collectBlocks(payload, "Skill");
  summary.skills = skillBlocks.slice(0, 40).map((skill, index) => {
    const gems = collectTagAttributes(skill.body, "Gem").map((gem) => ({
      name: compact(gem.nameSpec || gem.name || gem.gemId || gem.skillId),
      level: compact(gem.level),
      quality: compact(gem.quality || gem.qualityId),
      enabled: compact(gem.enabled),
      support: compact(gem.support || gem.supportGem),
    })).filter((gem) => gem.name);
    const mainGem = gems.find((gem) => !String(gem.support).match(/^(true|1)$/i)) || gems[0];
    return {
      id: compact(skill.attributes.slot || skill.attributes.id || String(index + 1)),
      label: compact(skill.attributes.label || skill.attributes.name || mainGem?.name || `Skill group ${index + 1}`),
      enabled: compact(skill.attributes.enabled),
      mainActiveSkill: compact(skill.attributes.mainActiveSkill),
      gems,
    };
  }).filter((skill) => skill.gems.length > 0 || skill.label);

  const tree = firstTagAttributes(payload, "Tree");
  const url = textFromTag(payload, "URL") || tree.url;
  const nodes = collectTagAttributes(payload, "Node");
  summary.passiveTree = {
    url: compact(url),
    treeVersion: compact(tree.treeVersion || spec.treeVersion),
    allocatedNodeCount: nodes.length || undefined,
  };

  const lowerPayload = payload.toLowerCase();
  for (const term of ["twister", "trinity", "fire", "cold", "lightning", "chaos", "armour", "evasion", "block", "energy shield", "resistance"]) {
    if (lowerPayload.includes(term)) summary.detectedTerms.push(term);
  }

  if (summary.skills.length === 0) warnings.push("No skill groups were parsed from this XML. The export may use tags this lightweight parser does not yet recognize.");
  if (summary.items.length === 0) warnings.push("No equipped/custom items were parsed from this XML. MCP/PoB import will be needed for complete item inspection.");
  if (Object.keys(summary.defenses).length === 0) warnings.push("No defense totals were found in the XML. Exact defenses require PoB/MCP calculations.");

  return summary;
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

/** Merge our local tools with whatever poe2-mcp has connected. */
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

async function executeTool(name, args) {
  if (LOCAL_TOOL_NAMES.has(name)) {
    return executeLocalTool(name, args);
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
    sendJson(response, 200, {
      ok: true,
      buildsLoaded: snapshots.size,
      poe2Mcp: {
        connected: poe2Mcp.ready,
        toolCount: poe2Mcp.tools.length,
        tools: poe2Mcp.toolNames,
      },
      localTools: [...LOCAL_TOOL_NAMES],
      allTools: [...LOCAL_TOOL_NAMES, ...poe2Mcp.toolNames],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/build/current") {
    sendJson(response, 200, { snapshots: [...snapshots.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
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

  if (request.method === "POST" && url.pathname === "/api/build/import") {
    const body = await readJson(request);
    const error = validateImportPayload(body);
    if (error) {
      sendJson(response, 400, { error });
      return;
    }

    const rawPayload = body.payload.replace(/\r\n/g, "\n").trim();
    let resolved;
    try {
      resolved = await resolveToXml(rawPayload);
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
    const summary = parseBuildSummary(xml, body.source);
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
    const poe2McpStatus = poe2Mcp.ready
      ? `poe2-mcp is CONNECTED with ${poe2Mcp.tools.length} live game tools: ${poe2Mcp.toolNames.slice(0, 8).join(", ")}...`
      : "poe2-mcp is NOT connected (pip install poe2-mcp needed). You only have the 6 local PoB parse tools.";

    const systemPrompt = [
      "You are PoBAI, a Path of Exile 2 build advisor with direct access to the player's imported build data and live game knowledge tools.",
      "",
      `Tool status: ${poe2McpStatus}`,
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

// Connect to poe2-mcp in background — server starts immediately regardless.
// Launched as a Python module by default; see poe2-mcp-client.mjs for overrides.
poe2Mcp.connect().catch(() => {});

server.listen(port, host, () => {
  console.log(`PoBAI server listening on http://${host}:${port}`);
  console.log(`Loaded ${snapshots.size} persisted snapshot(s) from ${dataRoot}`);
  console.log(`Open the app at http://localhost:${port}`);
});
