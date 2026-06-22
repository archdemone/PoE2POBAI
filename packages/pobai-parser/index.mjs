import { inflateSync, inflateRawSync } from "node:zlib";

export function decodePobCode(code) {
  const normalized = code.trim().replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(normalized, "base64");
  try {
    return inflateSync(buf).toString("utf8");
  } catch {
    return inflateRawSync(buf).toString("utf8");
  }
}

export function isPobCode(input) {
  const trimmed = input.trim();
  return !trimmed.startsWith("<") && !/^https?:\/\//i.test(trimmed);
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
  const attrs = {};
  for (const m of text.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]] = decodeXml(m[2]);
  }
  return attrs;
}

function firstTagAttrs(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b([^>]*)>`, "i"));
  return m ? parseAttributes(m[1]) : {};
}

function collectTagAttrs(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, "gi"))].map((m) =>
    parseAttributes(m[1])
  );
}

function collectBlocks(xml, tag) {
  return [
    ...xml.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi")
    ),
  ].map((m) => ({ attributes: parseAttributes(m[1]), body: m[2] }));
}

function textFromTag(body, tag) {
  const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXml(m[1].replace(/<[^>]*>/g, "").trim()) : "";
}

function compact(v) {
  return v === undefined || v === null || v === "" ? undefined : v;
}

const DEFENSE_KEYS = [
  "life", "energyshield", "energy_shield", "es", "armour", "armor",
  "evasion", "block", "fire", "cold", "lightning", "chaos", "resistance", "resist",
];

export function parseBuildXml(xml) {
  const warnings = [];
  const summary = {
    kind: "pob-xml",
    character: {},
    skills: [],
    items: [],
    passiveTree: {},
    defenses: {},
    detectedTerms: [],
    warnings,
  };

  const build = firstTagAttrs(xml, "Build");
  const player = firstTagAttrs(xml, "Player");
  const spec = firstTagAttrs(xml, "Spec");
  summary.character = {
    name: compact(build["characterName"] || build["name"] || player["name"]),
    className: compact(build["className"] || build["class"] || player["className"] || player["class"]),
    ascendancy: compact(build["ascendClassName"] || build["ascendancyName"] || spec["ascendClassName"]),
    level: compact(build["level"] || player["level"]),
    league: compact(build["league"] || player["league"]),
  };

  for (const stat of [
    ...collectTagAttrs(xml, "PlayerStat"),
    ...collectTagAttrs(xml, "Stat"),
    ...collectTagAttrs(xml, "Mod"),
  ]) {
    const key = String(stat["stat"] || stat["name"] || stat["id"] || "").toLowerCase();
    const value = compact(stat["value"] || stat["val"] || stat["total"] || stat["amount"]);
    if (!key || value === undefined) continue;
    if (DEFENSE_KEYS.some((dk) => key.includes(dk))) {
      const rawKey = stat["stat"] || stat["name"] || stat["id"] || key;
      summary.defenses[rawKey] = value;
    }
  }

  summary.items = collectBlocks(xml, "Item")
    .slice(0, 80)
    .map((item, i) => {
      const lines = decodeXml(item.body.replace(/<[^>]+>/g, "\n"))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        id: compact(item.attributes["id"] || item.attributes["itemId"] || String(i + 1)),
        slot: compact(item.attributes["slot"] || item.attributes["inventoryId"] || item.attributes["location"]),
        name: compact(textFromTag(item.body, "Name") || item.attributes["name"] || lines[0]),
        typeLine: compact(textFromTag(item.body, "TypeLine") || item.attributes["typeLine"] || lines[1]),
        rarity: compact(item.attributes["rarity"]),
      };
    })
    .filter((item) => item.name || item.typeLine || item.slot);

  summary.skills = collectBlocks(xml, "Skill")
    .slice(0, 40)
    .map((skill, i) => {
      const gems = collectTagAttrs(skill.body, "Gem")
        .map((gem) => ({
          name: compact(gem["nameSpec"] || gem["name"] || gem["gemId"] || gem["skillId"]),
          level: compact(gem["level"]),
          quality: compact(gem["quality"] || gem["qualityId"]),
          enabled: compact(gem["enabled"]),
          support: compact(gem["support"] || gem["supportGem"]),
        }))
        .filter((gem) => gem.name);
      const mainGem = gems.find((g) => !String(g.support).match(/^(true|1)$/i)) ?? gems[0];
      return {
        id: compact(skill.attributes["slot"] || skill.attributes["id"] || String(i + 1)),
        label: compact(skill.attributes["label"] || skill.attributes["name"] || mainGem?.name || `Skill group ${i + 1}`),
        enabled: compact(skill.attributes["enabled"]),
        mainActiveSkill: compact(skill.attributes["mainActiveSkill"]),
        gems,
      };
    })
    .filter((skill) => skill.gems.length > 0 || skill.label);

  const tree = firstTagAttrs(xml, "Tree");
  const treeSpec = firstTagAttrs(xml, "Spec");
  const nodeIds = collectTagAttrs(xml, "Node")
    .map((n) => n["id"] ?? n["nodeId"])
    .filter((id) => Boolean(id));
  summary.passiveTree = {
    url: compact(textFromTag(xml, "URL") || tree["url"]),
    treeVersion: compact(tree["treeVersion"] || treeSpec["treeVersion"]),
    allocatedNodeCount: nodeIds.length || undefined,
    allocatedNodeIds: nodeIds.length > 0 ? nodeIds : undefined,
  };

  const lower = xml.toLowerCase();
  for (const term of [
    "twister", "trinity", "fire", "cold", "lightning", "chaos",
    "armour", "evasion", "block", "energy shield", "resistance",
  ]) {
    if (lower.includes(term)) summary.detectedTerms.push(term);
  }

  if (summary.skills.length === 0)
    warnings.push("No skill groups parsed — the export may use tags this parser doesn't recognize.");
  if (summary.items.length === 0)
    warnings.push("No equipped items parsed — PoB2 calculation bridge needed for full item inspection.");
  if (Object.keys(summary.defenses).length === 0)
    warnings.push("No defense stats found in XML — exact values require PoB2 calculation bridge.");

  return summary;
}

export function parseBuild(input) {
  let xml = input.trim();

  if (isPobCode(xml)) {
    try {
      xml = decodePobCode(xml);
    } catch {
      return {
        xml: input,
        summary: {
          kind: "opaque",
          character: {},
          skills: [],
          items: [],
          passiveTree: {},
          defenses: {},
          detectedTerms: [],
          warnings: ["Could not decompress PoB code. Paste raw PoB2 XML export instead."],
        },
      };
    }
  }

  if (!/PathOfBuilding/i.test(xml)) {
    return {
      xml: input,
      summary: {
        kind: "opaque",
        character: {},
        skills: [],
        items: [],
        passiveTree: {},
        defenses: {},
        detectedTerms: [],
        warnings: ["Input does not appear to be valid PoB2 XML (missing PathOfBuilding root element)."],
      },
    };
  }

  return { xml, summary: parseBuildXml(xml) };
}
