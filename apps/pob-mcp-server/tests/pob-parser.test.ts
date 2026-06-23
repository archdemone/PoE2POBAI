import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
  parseBuild,
  parseBuildXml,
  isPobCode,
  decodePobCode,
} from "../src/pob-parser.js";

const SAMPLE_XML = `<PathOfBuilding2>
  <Build characterName="Smoke Twister" className="Ranger" ascendClassName="Deadeye" level="72" />
  <Skills>
    <Skill label="Twister main setup">
      <Gem nameSpec="Twister" level="18" />
      <Gem nameSpec="Trinity Support" support="true" level="17" />
      <Gem nameSpec="Added Cold Damage Support" support="true" level="18" />
    </Skill>
    <Skill label="Utility">
      <Gem nameSpec="Flame Dash" level="10" />
    </Skill>
  </Skills>
  <Items>
    <Item id="1" slot="Weapon 1">
      <Name>Smoke Bow</Name>
      <TypeLine>Expert Bow</TypeLine>
    </Item>
    <Item id="2" slot="Body Armour">
      <Name>Shroud of False Death</Name>
      <TypeLine>Expert Body Armour</TypeLine>
    </Item>
  </Items>
  <PlayerStat stat="Life" value="3200" />
  <PlayerStat stat="Cold Resistance" value="75" />
  <PlayerStat stat="Fire Resistance" value="60" />
  <PlayerStat stat="Energy Shield" value="0" />
  <Tree treeVersion="2.1.0">
    <Node id="101" />
    <Node id="202" />
    <Node id="303" />
  </Tree>
</PathOfBuilding2>`;

describe("isPobCode", () => {
  it("returns false for XML", () => {
    expect(isPobCode("<PathOfBuilding2>")).toBe(false);
  });

  it("returns false for URLs", () => {
    expect(isPobCode("https://poe.ninja/build/123")).toBe(false);
  });

  it("returns true for a base64-like string", () => {
    expect(isPobCode("eJxlkM1qwzAQ")).toBe(true);
  });
});

describe("parseBuildXml — character", () => {
  it("extracts className", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.character.className).toBe("Ranger");
  });

  it("extracts ascendancy", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.character.ascendancy).toBe("Deadeye");
  });

  it("extracts level", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.character.level).toBe("72");
  });

  it("extracts character name", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.character.name).toBe("Smoke Twister");
  });
});

describe("real PoB2 export quirks", () => {
  it("parses skills with self-closing gems and no </Skill> close tags", () => {
    // Real PoB2 exports omit </Skill> and use self-closing <Gem .../> children.
    const xml = `<PathOfBuilding2><Build className="Monk" level="90"/>
      <Skills><SkillSet id="1">
        <Skill enabled="true" mainActiveSkill="1">
          <Gem nameSpec="Ice Strike" level="20" quality="20"/>
          <Gem nameSpec="Martial Tempo" level="18"/>
        <Skill enabled="true">
          <Gem nameSpec="Bell" level="19"/>
      </SkillSet></Skills></PathOfBuilding2>`;
    const skills = parseBuildXml(xml).skills;
    expect(skills).toHaveLength(2);
    expect(skills[0].gems.map((g) => g.name)).toEqual(["Ice Strike", "Martial Tempo"]);
    expect(skills[1].gems.map((g) => g.name)).toEqual(["Bell"]);
  });

  it("decodes a PoB code whose trailing checksum was lost in copy-paste", () => {
    const xml = `<PathOfBuilding2><Build className="Monk" level="90"/></PathOfBuilding2>`;
    const full = deflateSync(Buffer.from(xml, "utf8"));
    const truncated = full.subarray(0, full.length - 4); // drop the Adler-32 check
    const code = truncated.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodePobCode(code)).toContain("PathOfBuilding");
  });
});

describe("parseBuildXml — item affixes", () => {
  // Real PoB exports store items as raw clipboard text anchored on a "Rarity:" line.
  const RARE_ITEM_XML = `<PathOfBuilding2>
    <Build characterName="Modder" className="Witch" level="80" />
    <Item id="1" slot="Body Armour">Rarity: RARE
Doom Shell
Expert Vaal Cuirass
Item Level: 82
Quality: +20
Sockets: R-R-G
+45 to maximum Life
+38% to Fire Resistance
{crafted}+12% to Cold Resistance</Item>
  </PathOfBuilding2>`;

  it("extracts item level, quality, and sockets", () => {
    const item = parseBuildXml(RARE_ITEM_XML).items[0];
    expect(item.itemLevel).toBe("82");
    expect(item.quality).toBe("20");
    expect(item.sockets).toBe("R-R-G");
  });

  it("extracts affix mods and strips crafting tags", () => {
    const item = parseBuildXml(RARE_ITEM_XML).items[0];
    expect(item.mods).toContain("+45 to maximum Life");
    expect(item.mods).toContain("+38% to Fire Resistance");
    expect(item.mods).toContain("+12% to Cold Resistance");
    expect(item.mods).not.toContain("Doom Shell");
  });

  it("leaves mods empty for subtag-style items without a Rarity anchor", () => {
    const item = parseBuildXml(SAMPLE_XML).items[0];
    expect(item.mods).toEqual([]);
    expect(item.name).toBe("Smoke Bow");
  });
});

describe("parseBuildXml — passive tree", () => {
  it("reads allocated nodes from a Spec nodes attribute", () => {
    const xml = `<PathOfBuilding2><Build className="Witch" level="80" />
      <Spec treeVersion="0_5" nodes="4,55,52" masteryEffects="{12345,67}" /></PathOfBuilding2>`;
    const tree = parseBuildXml(xml).passiveTree;
    expect(tree.allocatedNodeIds).toEqual(["4", "55", "52"]);
    expect(tree.allocatedNodeCount).toBe(3);
    expect(tree.treeVersion).toBe("0_5");
    expect(tree.masteryEffects).toEqual([{ node: "12345", effect: "67" }]);
  });

  it("still reads legacy <Node> tags and de-dupes against Spec nodes", () => {
    const xml = `<PathOfBuilding2><Build className="Witch" />
      <Spec nodes="100,200" /><Tree><Node id="200" /><Node id="300" /></Tree></PathOfBuilding2>`;
    const tree = parseBuildXml(xml).passiveTree;
    expect(tree.allocatedNodeIds).toEqual(["100", "200", "300"]);
  });
});

describe("parseBuildXml — skills", () => {
  it("parses two skill groups", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.skills).toHaveLength(2);
  });

  it("parses gems within a skill group", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const main = summary.skills.find((s) => s.label?.includes("Twister"));
    expect(main).toBeDefined();
    expect(main!.gems).toHaveLength(3);
  });

  it("identifies support gems", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const main = summary.skills[0]!;
    const supports = main.gems.filter((g) =>
      String(g.support).match(/^(true|1)$/i)
    );
    expect(supports).toHaveLength(2);
  });

  it("extracts gem levels", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const twister = summary.skills[0]!.gems[0]!;
    expect(twister.level).toBe("18");
  });
});

describe("parseBuildXml — items", () => {
  it("parses two items", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.items).toHaveLength(2);
  });

  it("extracts item slot and name", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const weapon = summary.items.find((i) => i.slot === "Weapon 1");
    expect(weapon).toBeDefined();
    expect(weapon!.name).toBe("Smoke Bow");
    expect(weapon!.typeLine).toBe("Expert Bow");
  });
});

describe("parseBuildXml — defenses", () => {
  it("extracts Life stat", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.defenses["Life"]).toBe("3200");
  });

  it("extracts resistance stats", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.defenses["Cold Resistance"]).toBe("75");
    expect(summary.defenses["Fire Resistance"]).toBe("60");
  });
});

describe("parseBuildXml — passive tree", () => {
  it("extracts tree version", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.passiveTree.treeVersion).toBe("2.1.0");
  });

  it("counts allocated nodes", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.passiveTree.allocatedNodeCount).toBe(3);
  });

  it("extracts allocated node IDs for poe2-mcp handoff", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.passiveTree.allocatedNodeIds).toEqual(["101", "202", "303"]);
  });
});

describe("parseBuildXml — detected terms", () => {
  it("detects fire, cold, lightning, evasion", () => {
    const summary = parseBuildXml(SAMPLE_XML);
    expect(summary.detectedTerms).toContain("fire");
    expect(summary.detectedTerms).toContain("cold");
  });
});

describe("parseBuild — XML path", () => {
  it("parses raw XML the same as parseBuildXml", () => {
    const { summary } = parseBuild(SAMPLE_XML);
    expect(summary.kind).toBe("pob-xml");
    expect(summary.character.className).toBe("Ranger");
  });
});

describe("parseBuild — invalid input", () => {
  it("returns opaque kind for junk input", () => {
    const { summary } = parseBuild("not xml at all");
    expect(summary.kind).toBe("opaque");
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  it("returns opaque kind for XML that isn't PoB", () => {
    const { summary } = parseBuild("<root><child /></root>");
    expect(summary.kind).toBe("opaque");
  });
});

describe("parseBuild — XML entity decoding", () => {
  it("decodes HTML entities in attribute values", () => {
    const xml = `<PathOfBuilding2>
      <Build className="Witch &amp; Warlock" level="50" />
    </PathOfBuilding2>`;
    const { summary } = parseBuild(xml);
    expect(summary.character.className).toBe("Witch & Warlock");
  });
});

describe("decodePobCode", () => {
  it("round-trips: compress then decompress recovers the original", () => {
    const xml = "<PathOfBuilding2><Build className=\"Ranger\" /></PathOfBuilding2>";
    const compressed = deflateSync(Buffer.from(xml, "utf8"));
    const code = compressed.toString("base64");
    const decoded = decodePobCode(code);
    expect(decoded).toBe(xml);
  });
});
