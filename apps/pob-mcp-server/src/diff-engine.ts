function parseAttributes(text = ""): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of text.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]!] = m[2]!;
  }
  return attrs;
}

function collectBlocks(
  xml: string,
  tag: string
): Array<{ attributes: Record<string, string>; body: string }> {
  return [
    ...xml.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi")
    ),
  ].map((m) => ({ attributes: parseAttributes(m[1]!), body: m[2]! }));
}

function collectTagAttrs(xml: string, tag: string): Record<string, string>[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, "gi"))].map((m) =>
    parseAttributes(m[1]!)
  );
}

function firstTagAttrs(xml: string, tag: string): Record<string, string> {
  const m = xml.match(new RegExp(`<${tag}\\b([^>]*)>`, "i"));
  return m ? parseAttributes(m[1]!) : {};
}

function textFromTag(body: string, tag: string): string {
  const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1]!.replace(/<[^>]*>/g, "").trim() : "";
}

function skillKey(skill: { attributes: Record<string, string>; body: string }): string {
  return skill.attributes["label"] || textFromTag(skill.body, "Name") || "unknown";
}

function gemNames(skill: { body: string }): string[] {
  return collectTagAttrs(skill.body, "Gem")
    .map((g) => g["nameSpec"] || g["name"] || g["gemId"] || "")
    .filter(Boolean);
}

function itemKey(item: { attributes: Record<string, string>; body: string }): string {
  return item.attributes["slot"] || textFromTag(item.body, "Name") || "unknown";
}

function nodeIds(xml: string): string[] {
  return collectTagAttrs(xml, "Node")
    .map((n) => n["id"] ?? n["nodeId"])
    .filter((id): id is string => Boolean(id));
}

/**
 * Compute a structured diff between two PoB2 XML payloads.
 */
export function computeDiff(
  xml1: string,
  xml2: string,
  baseId: string,
  targetId: string
): {
  baseId: string;
  targetId: string;
  skillsAdded: Array<{ label: string; gems: string[] }>;
  skillsRemoved: Array<{ label: string; gems: string[] }>;
  itemsAdded: Array<{ slot?: string; name?: string }>;
  itemsRemoved: Array<{ slot?: string; name?: string }>;
  defensesChanged: Record<string, { from?: string; to?: string }>;
  passivesChanged: { nodesAdded: number; nodesRemoved: number };
  textPatch?: string;
} {
  const skills1 = collectBlocks(xml1, "Skill");
  const skills2 = collectBlocks(xml2, "Skill");
  const items1 = collectBlocks(xml1, "Item");
  const items2 = collectBlocks(xml2, "Item");

  const skillKeys1 = new Set(skills1.map(skillKey));
  const skillKeys2 = new Set(skills2.map(skillKey));

  const skillsRemoved = skills1
    .filter((s) => !skillKeys2.has(skillKey(s)))
    .map((s) => ({ label: skillKey(s), gems: gemNames(s) }));

  const skillsAdded = skills2
    .filter((s) => !skillKeys1.has(skillKey(s)))
    .map((s) => ({ label: skillKey(s), gems: gemNames(s) }));

  const itemKeys1 = new Set(items1.map(itemKey));
  const itemKeys2 = new Set(items2.map(itemKey));

  const itemsRemoved = items1
    .filter((i) => !itemKeys2.has(itemKey(i)))
    .map((i) => ({ slot: i.attributes["slot"], name: textFromTag(i.body, "Name") || i.attributes["name"] }));

  const itemsAdded = items2
    .filter((i) => !itemKeys1.has(itemKey(i)))
    .map((i) => ({ slot: i.attributes["slot"], name: textFromTag(i.body, "Name") || i.attributes["name"] }));

  const defs1 = firstTagAttrs(xml1, "PlayerStat");
  const defs2 = firstTagAttrs(xml2, "PlayerStat");
  const allDefKeys = new Set([...Object.keys(defs1), ...Object.keys(defs2)]);
  const defensesChanged: Record<string, { from?: string; to?: string }> = {};
  for (const key of allDefKeys) {
    if (defs1[key] !== defs2[key]) {
      defensesChanged[key] = { from: defs1[key], to: defs2[key] };
    }
  }

  const nodes1 = new Set(nodeIds(xml1));
  const nodes2 = new Set(nodeIds(xml2));
  const nodesAdded = [...nodes2].filter((n) => !nodes1.has(n)).length;
  const nodesRemoved = [...nodes1].filter((n) => !nodes2.has(n)).length;

  const lines1 = xml1.split("\n");
  const lines2 = xml2.split("\n");
  const patchLines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < lines1.length || j < lines2.length) {
    if (i < lines1.length && j < lines2.length && lines1[i] === lines2[j]) {
      i++;
      j++;
    } else if (i < lines1.length && (j >= lines2.length || lines1[i] !== lines2[j])) {
      const start = i + 1;
      let count = 0;
      while (i < lines1.length && (j >= lines2.length || lines1[i] !== lines2[j])) {
        i++;
        count++;
      }
      patchLines.push(`@@ -${start},${count} @@`);
    } else if (j < lines2.length && (i >= lines1.length || lines1[i] !== lines2[j])) {
      const start = j + 1;
      let count = 0;
      while (j < lines2.length && (i >= lines1.length || lines1[i] !== lines2[j])) {
        j++;
        count++;
      }
      patchLines.push(`@@ +${start},${count} @@`);
    }
  }
  const textPatch = patchLines.length > 0 ? patchLines.join("\n") : undefined;

  return {
    baseId,
    targetId,
    skillsAdded,
    skillsRemoved,
    itemsAdded,
    itemsRemoved,
    defensesChanged,
    passivesChanged: { nodesAdded, nodesRemoved },
    textPatch,
  };
}
