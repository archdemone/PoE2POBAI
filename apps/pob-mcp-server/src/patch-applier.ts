/**
 * Apply an XML patch string to a PoB2 XML payload.
 *
 * The patch format uses an XML-like instruction syntax:
 *
 *   <AddSkill label="..." gems="..."/>
 *   <RemoveSkill label="..."/>
 *   <ReplaceAttr selector="Build" name="className" value="Marauder"/>
 *   <AddItem slot="Weapon 1" name="..."/>
 *   <RemoveItem slot="Weapon 1"/>
 *   <ReplaceDefense name="Life" value="5000"/>
 *   <AddNodes ids="12345,67890"/>
 *   <RemoveNodes ids="12345"/>
 *   <ReplacePassiveTree url="..." treeVersion="..."/>
 *
 * Each instruction operates on the XML as a string.
 */

function parsePatchLine(line: string): { tag: string; attrs: Record<string, string> } | null {
  const m = line.trim().match(/^<(\w+)\s+([^>]*)\/?>$/);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of m[2]!.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    attrs[a[1]!] = a[2]!;
  }
  return { tag: m[1]!, attrs };
}

function setTagAttribute(xml: string, tag: string, name: string, value: string): string {
  return xml.replace(
    new RegExp(`(<${tag}\\b[^>]*\\b)${name}="[^"]*"`, "i"),
    `$1${name}="${value}"`
  );
}

function hasTagAttribute(xml: string, tag: string, name: string): boolean {
  return new RegExp(`<${tag}\\b[^>]*\\b${name}=`, "i").test(xml);
}

function addTagAttribute(xml: string, tag: string, name: string, value: string): string {
  if (hasTagAttribute(xml, tag, name)) {
    return setTagAttribute(xml, tag, name, value);
  }
  return xml.replace(
    new RegExp(`(<${tag}\\b)`, "i"),
    `$1${name}="${value}" `
  );
}

function removeSkillBlock(xml: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.replace(
    new RegExp(`\\s*<Skill[^>]*label="${escaped}"[^>]*>[\\s\\S]*?</Skill>`, "gi"),
    ""
  );
}

function removeItemBlock(xml: string, slot: string): string {
  const escaped = slot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.replace(
    new RegExp(`\\s*<Item[^>]*slot="${escaped}"[^>]*>[\\s\\S]*?</Item>`, "gi"),
    ""
  );
}

function removeNodesByIds(xml: string, ids: string[]): string {
  const idSet = new Set(ids);
  const nodeRE = /<Node\s+([^>]*)\/>/gi;
  return xml.replace(nodeRE, (match, attrsStr) => {
    const idM = attrsStr.match(/\b(?:id|nodeId)\s*=\s*"([^"]*)"/i);
    if (idM && idSet.has(idM[1]!)) return "";
    return match;
  });
}

function addSkillBlock(xml: string, label: string, gems: string): string {
  const gemTags = gems
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => `      <Gem nameSpec="${g}"/>`)
    .join("\n");
  const block = `\n    <Skill label="${label}">\n${gemTags}\n    </Skill>`;
  const skillsEnd = xml.lastIndexOf("</Skills>");
  if (skillsEnd === -1) return xml + block;
  return xml.slice(0, skillsEnd) + block + xml.slice(skillsEnd);
}

function addItemBlock(xml: string, slot: string, name: string): string {
  const m = xml.match(/(\s*)<\/Items>/i);
  if (!m) return xml;
  const indent = m[1] || "\n  ";
  const block = `${indent}  <Item slot="${slot}">${indent}    <Name>${name}</Name>${indent}  </Item>`;
  return xml.replace(/(<\/Items>)/i, block + "$1");
}

/**
 * Apply a multi-line XML patch string to a PoB2 XML payload.
 * Returns the modified XML or null if the patch could not be applied.
 */
export function applyPatch(xml: string, patchStr: string): string | null {
  let result = xml;
  const lines = patchStr.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const instr = parsePatchLine(line);
    if (!instr) continue;

    switch (instr.tag) {
      case "AddSkill": {
        if (instr.attrs["label"]) {
          result = addSkillBlock(result, instr.attrs["label"], instr.attrs["gems"] || "");
        }
        break;
      }
      case "RemoveSkill": {
        if (instr.attrs["label"]) {
          result = removeSkillBlock(result, instr.attrs["label"]);
        }
        break;
      }
      case "ReplaceAttr": {
        if (instr.attrs["selector"] && instr.attrs["name"] && instr.attrs["value"] !== undefined) {
          if (hasTagAttribute(result, instr.attrs["selector"], instr.attrs["name"])) {
            result = setTagAttribute(result, instr.attrs["selector"], instr.attrs["name"], instr.attrs["value"]);
          } else {
            result = addTagAttribute(result, instr.attrs["selector"], instr.attrs["name"], instr.attrs["value"]);
          }
        }
        break;
      }
      case "AddItem": {
        if (instr.attrs["slot"]) {
          result = addItemBlock(result, instr.attrs["slot"], instr.attrs["name"] || "");
        }
        break;
      }
      case "RemoveItem": {
        if (instr.attrs["slot"]) {
          result = removeItemBlock(result, instr.attrs["slot"]);
        }
        break;
      }
      case "ReplaceDefense": {
        if (instr.attrs["name"] && instr.attrs["value"] !== undefined) {
          result = result.replace(
            new RegExp(`(<PlayerStat[^>]*\\b)${instr.attrs["name"]}="[^"]*"`, "i"),
            `$1${instr.attrs["name"]}="${instr.attrs["value"]}"`
          );
          if (!result.includes(`${instr.attrs["name"]}="`)) {
            result = result.replace(
              /(<PlayerStat\b)/i,
              `$1 ${instr.attrs["name"]}="${instr.attrs["value"]}"`
            );
          }
        }
        break;
      }
      case "AddNodes": {
        if (instr.attrs["ids"]) {
          const ids = instr.attrs["ids"].split(",").map((s) => s.trim()).filter(Boolean);
          const nodesBlock = ids.map((id) => `      <Node id="${id}"/>`).join("\n");
          const treeEnd = result.lastIndexOf("</Tree>");
          if (treeEnd !== -1) {
            result = result.slice(0, treeEnd) + "\n" + nodesBlock + "\n" + result.slice(treeEnd);
          }
        }
        break;
      }
      case "RemoveNodes": {
        if (instr.attrs["ids"]) {
          const ids = instr.attrs["ids"].split(",").map((s) => s.trim()).filter(Boolean);
          result = removeNodesByIds(result, ids);
        }
        break;
      }
      case "ReplacePassiveTree": {
        if (instr.attrs["url"] !== undefined) {
          result = result.replace(
            /<URL>[^<]*<\/URL>/i,
            `<URL>${instr.attrs["url"]}</URL>`
          );
        }
        if (instr.attrs["treeVersion"] !== undefined) {
          result = setTagAttribute(result, "Tree", "treeVersion", instr.attrs["treeVersion"]);
        }
        break;
      }
    }
  }

  if (result === xml) return null;
  return result;
}
