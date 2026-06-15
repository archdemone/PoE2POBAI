import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.POBAI_SERVER_PORT ?? 3001);
const host = process.env.POBAI_SERVER_HOST ?? "0.0.0.0";
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const webRoot = resolve(fileURLToPath(new URL("../../pobai-web", import.meta.url)));
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
    sendJson(response, 200, { ok: true, service: "pobai-server", version: "0.2.0", dependencyFree: true });
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

    const normalizedPayload = body.payload.replace(/\r\n/g, "\n").trim();
    const hash = createHash("sha256").update(normalizedPayload).digest("hex");
    const summary = parseBuildSummary(normalizedPayload, body.source);
    const snapshot = {
      id: randomUUID(),
      source: body.source,
      createdAt: new Date().toISOString(),
      label: body.label?.trim() || `${body.source} snapshot ${new Date().toISOString()}`,
      hash,
      sizeBytes: Buffer.byteLength(normalizedPayload, "utf8"),
      preview: normalizedPayload.slice(0, 240),
      summary,
    };

    snapshots.set(snapshot.id, snapshot);
    payloads.set(snapshot.id, normalizedPayload);
    await persistSnapshot(snapshot, normalizedPayload);
    sendJson(response, 201, { snapshot });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/mcp/tools") {
    sendJson(response, 200, {
      connected: false,
      tools: [],
      note: "MCP client wiring is intentionally stubbed in v0.2.0; poe2-mcp integration is the next milestone.",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(request);
    const error = validateChatPayload(body);
    if (error) {
      sendJson(response, 400, { error });
      return;
    }

    const snapshot = body.snapshotId ? snapshots.get(body.snapshotId) : undefined;
    const latestUserMessage = [...body.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const evidence = buildEvidence(snapshot, latestUserMessage);
    const systemContext = [
      "You are PoBAI, a Path of Exile 2 build assistant.",
      "You must be honest about data provenance.",
      "Never invent exact DPS, eHP, resistance caps, conversion percentages, ailment chances, or mitigation numbers.",
      "Use the imported snapshot context below only as extracted facts. If exact PoB/MCP calculations are unavailable, say so and give next-step guidance.",
      buildSnapshotContext(snapshot),
    ].join("\n");

    if (!body.apiKey || typeof body.apiKey !== "string") {
      sendJson(response, 200, {
        message: {
          id: randomUUID(),
          role: "assistant",
          createdAt: new Date().toISOString(),
          content: buildLocalDemoResponse(snapshot, latestUserMessage),
          evidence,
        },
      });
      return;
    }

    const openRouterResponse = await fetch(`${openRouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${body.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? `http://localhost:${port}`,
        "X-OpenRouter-Title": "PoBAI Local Proof of Concept",
      },
      body: JSON.stringify({
        model: body.model,
        messages: [{ role: "system", content: systemContext }, ...body.messages],
      }),
    });

    if (!openRouterResponse.ok) {
      sendJson(response, openRouterResponse.status, { error: "OpenRouter request failed", detail: await openRouterResponse.text() });
      return;
    }

    const data = await openRouterResponse.json();
    sendJson(response, 200, {
      message: {
        id: randomUUID(),
        role: "assistant",
        content: data.choices?.[0]?.message?.content ?? "OpenRouter returned an empty response.",
        createdAt: new Date().toISOString(),
        evidence,
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

server.listen(port, host, () => {
  console.log(`PoBAI dependency-free server listening on http://${host}:${port}`);
  console.log(`Loaded ${snapshots.size} persisted snapshot(s) from ${dataRoot}`);
  console.log(`Open the app at http://localhost:${port}`);
});
