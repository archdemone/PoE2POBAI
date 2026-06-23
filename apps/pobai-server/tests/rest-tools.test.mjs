import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "../src/index.mjs");

function getFreePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(port, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pobai-server on :${port} did not start within ${maxMs}ms`);
}

let pobaiPort;
let pobaiProc;
let dataDir;
let buildId;
let targetBuildId;

async function postJson(path, body) {
  const res = await fetch(`http://localhost:${pobaiPort}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json() };
}

beforeAll(async () => {
  pobaiPort = await getFreePort();
  dataDir = await mkdtemp(join(tmpdir(), "pobai-rest-tools-"));

  pobaiProc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      POBAI_SERVER_PORT: String(pobaiPort),
      POBAI_DATA_DIR: dataDir,
      POBAI_SEED_DEFAULT_BUILDS: "0",
      POE2_MCP_DISABLED: "1",
    },
    stdio: "pipe",
  });

  await waitForReady(pobaiPort);

  const pobXml = `<PathOfBuilding2>
    <Build characterName="TestRanger" className="Ranger" ascendClassName="Deadeye" level="85" league="Standard" />
    <PlayerStat stat="Life" value="3200" />
    <PlayerStat stat="EnergyShield" value="800" />
    <PlayerStat stat="Armour" value="4500" />
    <PlayerStat stat="Evasion" value="7200" />
    <PlayerStat stat="FireResist" value="75" />
    <PlayerStat stat="ColdResist" value="75" />
    <PlayerStat stat="LightningResist" value="75" />
    <PlayerStat stat="Block" value="250" />
    <Skill slot="1" label="Lightning Arrow" enabled="true" mainActiveSkill="LightningArrow">
      <Gem nameSpec="Lightning Arrow" level="20" quality="20" enabled="true" />
      <Gem nameSpec="Greater Multiple Projectiles" level="20" quality="20" enabled="true" support="true" />
      <Gem nameSpec="Chain" level="20" support="true" />
    </Skill>
    <Skill slot="2" label="Herald of Thunder" enabled="true">
      <Gem nameSpec="Herald of Thunder" level="20" quality="20" enabled="true" />
    </Skill>
    <Item id="1" slot="Weapon 1" rarity="Unique">
      <Name>Windripper</Name>
      <TypeLine>Imperial Bow</TypeLine>
      <Mod stat="PhysicalDamage" value="90-180" />
    </Item>
    <Item id="2" slot="Body Armour" rarity="Rare">
      <Name>Ranger's Vest</Name>
      <TypeLine>Assassin's Garb</TypeLine>
    </Item>
    <Tree treeVersion="2.1.0"><Node id="1234" /><Node id="5678" /><Node id="9012" /></Tree>
  </PathOfBuilding2>`;

  const { data } = await postJson("/api/build/import", {
    source: "pob-xml",
    label: "Base Ranger",
    payload: pobXml,
  });
  buildId = data.snapshot.id;

  const targetXml = `<PathOfBuilding2>
    <Build characterName="TargetRanger" className="Ranger" ascendClassName="Deadeye" level="88" league="Standard" />
    <PlayerStat stat="Life" value="3500" />
    <PlayerStat stat="EnergyShield" value="500" />
    <PlayerStat stat="Armour" value="6000" />
    <PlayerStat stat="Evasion" value="6500" />
    <PlayerStat stat="FireResist" value="80" />
    <PlayerStat stat="ColdResist" value="70" />
    <PlayerStat stat="LightningResist" value="75" />
    <PlayerStat stat="ChaosResist" value="20" />
    <PlayerStat stat="Block" value="252" />
    <Skill slot="1" label="Lightning Arrow" enabled="true" mainActiveSkill="LightningArrow">
      <Gem nameSpec="Lightning Arrow" level="21" quality="20" enabled="true" />
      <Gem nameSpec="Greater Multiple Projectiles" level="20" quality="20" enabled="true" support="true" />
      <Gem nameSpec="Fork" level="20" support="true" />
    </Skill>
    <Skill slot="3" label="Wind Dancer" enabled="true">
      <Gem nameSpec="Wind Dancer" level="18" enabled="true" />
    </Skill>
    <Item id="1" slot="Weapon 1" rarity="Rare">
      <Name>Storm Song</Name>
      <TypeLine>Expert Dualstring Bow</TypeLine>
    </Item>
    <Item id="2" slot="Body Armour" rarity="Rare">
      <Name>Ranger's Vest</Name>
      <TypeLine>Assassin's Garb</TypeLine>
    </Item>
    <Tree treeVersion="2.1.0"><Node id="1234" /><Node id="5678" /><Node id="9999" /><Node id="2222" /></Tree>
  </PathOfBuilding2>`;

  const target = await postJson("/api/build/import", {
    source: "pob-xml",
    label: "Target Ranger",
    payload: targetXml,
  });
  targetBuildId = target.data.snapshot.id;
}, 20_000);

afterAll(async () => {
  if (buildId) await fetch(`http://localhost:${pobaiPort}/api/build/${buildId}`, { method: "DELETE" });
  if (targetBuildId) await fetch(`http://localhost:${pobaiPort}/api/build/${targetBuildId}`, { method: "DELETE" });
  pobaiProc?.kill();
});

describe("REST tool endpoints", () => {
  it("GET /api/builds returns build list", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/builds`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((b) => b.snapshot_id === buildId)).toBe(true);
  });

  it("GET /api/build/:id/skills returns skills", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/build/${buildId}/skills`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skills).toBeDefined();
  });

  it("GET /api/build/:id/items returns items", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/build/${buildId}/items`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toBeDefined();
  });

  it("GET /api/build/:id/passive-tree returns tree", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/build/${buildId}/passive-tree`);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeDefined();
  });

  it("GET /api/build/:id/defenses returns defenses", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/build/${buildId}/defenses`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defenses).toBeDefined();
  });

  it("GET /api/build/:id/skills returns 404 for unknown ID", async () => {
    const res = await fetch(`http://localhost:${pobaiPort}/api/build/nonexistent/skills`);
    expect(res.status).toBe(404);
  });

  it("POST /api/build/compare returns a side-by-side comparison", async () => {
    const { res, data } = await postJson("/api/build/compare", {
      baseId: buildId,
      targetId: targetBuildId,
    });

    expect(res.status).toBe(200);
    expect(data.base.id).toBe(buildId);
    expect(data.target.id).toBe(targetBuildId);
    expect(data.character.fields.some((field) => field.key === "level" && field.status === "changed")).toBe(true);
    expect(data.skills.counts.changed).toBeGreaterThanOrEqual(1);
    expect(data.items.rows.find((row) => row.key === "weapon1")?.status).toBe("changed");
    expect(data.passiveTree.addedNodeIds).toEqual(["2222", "9999"]);
    expect(data.passiveTree.removedNodeIds).toEqual(["9012"]);
    expect(data.defenses.stats.length).toBeGreaterThan(0);
  });

  it("POST /api/build/compare returns 404 for missing snapshot IDs", async () => {
    const { res, data } = await postJson("/api/build/compare", {
      baseId: buildId,
      targetId: "missing-target",
    });

    expect(res.status).toBe(404);
    expect(data.missingIds).toEqual(["missing-target"]);
  });

  it("POST /api/build/compare includes numeric stat deltas and green/red metadata", async () => {
    const { data } = await postJson("/api/build/compare", {
      baseId: buildId,
      targetId: targetBuildId,
    });

    const life = data.statDiffs.find((stat) => stat.label === "Life");
    expect(life).toMatchObject({
      type: "numeric",
      baseValue: 3200,
      targetValue: 3500,
      delta: 300,
      direction: "increase",
      higherIsBetter: true,
      impact: "better",
      color: "green",
      status: "changed",
    });
    expect(life.percentDelta).toBeCloseTo(9.375, 3);
  });

  it("marks near-equal stats as neutral/white instead of green or red", async () => {
    const { data } = await postJson("/api/build/compare", { baseId: buildId, targetId: targetBuildId });
    const block = data.statDiffs.find((stat) => stat.label === "Block");
    expect(block).toMatchObject({
      delta: 2,
      near: true,
      status: "near",
      impact: "neutral",
      color: "neutral",
    });
  });

  it("attaches per-gem diffs to changed skill groups", async () => {
    const { data } = await postJson("/api/build/compare", { baseId: buildId, targetId: targetBuildId });
    const arrowRow = data.skills.rows.find((row) => row.status === "changed" && row.gemDiff);
    expect(arrowRow).toBeTruthy();
    const names = (gems) => gems.map((g) => g.name);
    expect(names(arrowRow.gemDiff.added)).toContain("Fork");
    expect(names(arrowRow.gemDiff.removed)).toContain("Chain");
    const releveled = arrowRow.gemDiff.changed.find((c) => c.name === "Lightning Arrow");
    expect(releveled).toBeTruthy();
    expect(releveled.level).toMatchObject({ baseValue: 20, targetValue: 21, color: "green" });
  });

  it("parses <Spec nodes> and enriches passive node ids with names and stats", async () => {
    // Real PoB2 exports store allocated passives in a Spec nodes="..." attribute.
    // 0_5 tree: 4 = Shock Chance (small), 55 = Fast Acting Toxins (notable), 52 = Zealot's Oath (keystone).
    const mine = await postJson("/api/build/import", {
      source: "pob-xml",
      label: "Tree Base",
      payload: `<PathOfBuilding2><Build className="Witch" level="80" /><Spec treeVersion="0_5" nodes="4,55" /></PathOfBuilding2>`,
    });
    const guide = await postJson("/api/build/import", {
      source: "pob-xml",
      label: "Tree Target",
      payload: `<PathOfBuilding2><Build className="Witch" level="90" /><Spec treeVersion="0_5" nodes="4,52" /></PathOfBuilding2>`,
    });

    const { data } = await postJson("/api/build/compare", {
      baseId: mine.data.snapshot.id,
      targetId: guide.data.snapshot.id,
    });

    expect(data.passiveTree.addedNodeIds).toEqual(["52"]);
    expect(data.passiveTree.removedNodeIds).toEqual(["55"]);
    expect(data.passiveTree.sharedNodeCount).toBe(1);
    expect(data.passiveTree.treeDataVersion).toMatchObject({ version: "0_5", exact: true });

    const keystone = data.passiveTree.nodesToAllocate.groups.keystone[0];
    expect(keystone).toMatchObject({ id: "52", name: "Zealot's Oath", type: "keystone" });
    expect(keystone.stats).toContain("Energy Shield does not Recharge");

    const notable = data.passiveTree.nodesToRemove.groups.notable[0];
    expect(notable).toMatchObject({ id: "55", name: "Fast Acting Toxins", type: "notable" });

    await fetch(`http://localhost:${pobaiPort}/api/build/${mine.data.snapshot.id}`, { method: "DELETE" });
    await fetch(`http://localhost:${pobaiPort}/api/build/${guide.data.snapshot.id}`, { method: "DELETE" });
  });

  it("attaches per-property diffs to changed item slots", async () => {
    const { data } = await postJson("/api/build/compare", { baseId: buildId, targetId: targetBuildId });
    const weapon = data.items.rows.find((row) => row.key === "weapon1");
    expect(weapon.status).toBe("changed");
    expect(weapon.itemDiff).toBeTruthy();
    const nameChange = weapon.itemDiff.properties.find((p) => p.label === "Name");
    expect(nameChange).toMatchObject({ baseValue: "Windripper", targetValue: "Storm Song" });
  });

  it("POST /api/build/import accepts legacy code while keeping payload canonical", async () => {
    const legacyXml = `<PathOfBuilding2>
      <Build characterName="LegacyImport" className="Monk" level="70" />
      <PlayerStat stat="Life" value="2500" />
    </PathOfBuilding2>`;

    const { res, data } = await postJson("/api/build/import", {
      source: "pob-xml",
      label: "Legacy Code Import",
      code: legacyXml,
    });

    expect(res.status).toBe(201);
    expect(data.snapshot.summary.character.name).toBe("LegacyImport");
    await fetch(`http://localhost:${pobaiPort}/api/build/${data.snapshot.id}`, { method: "DELETE" });
  });

  it("POST /api/build/import dedups identical builds instead of creating duplicates", async () => {
    const dedupXml = `<PathOfBuilding2>
      <Build characterName="DedupMonk" className="Monk" ascendClassName="Martial Artist" level="96" />
      <PlayerStat stat="Life" value="4200" />
    </PathOfBuilding2>`;

    const first = await postJson("/api/build/import", { source: "pob-xml", label: "Dedup Build", payload: dedupXml });
    expect(first.res.status).toBe(201);

    // Re-importing the exact same build returns the SAME snapshot id...
    const second = await postJson("/api/build/import", { source: "pob-xml", label: "Dedup Build Again", payload: dedupXml });
    expect(second.data.snapshot.id).toBe(first.data.snapshot.id);

    // ...and the build list contains only one entry for that build.
    const list = await (await fetch(`http://localhost:${pobaiPort}/api/builds`)).json();
    const matches = list.filter((b) => b.snapshot_id === first.data.snapshot.id);
    expect(matches.length).toBe(1);

    await fetch(`http://localhost:${pobaiPort}/api/build/${first.data.snapshot.id}`, { method: "DELETE" });
  });

  it("matches skills by identity, not socket slot, so reordered groups aren't false diffs", async () => {
    // Same two skills, opposite slot order between the builds, plus the gems within
    // a group reordered. Slot-keyed comparison would report everything as
    // added/removed/changed; identity matching must see them as the same.
    const left = `<PathOfBuilding2>
      <Build characterName="OrderA" className="Monk" ascendClassName="Martial Artist" level="96" />
      <Skill slot="1" label="Ice Strike" enabled="true"><Gem nameSpec="Ice Strike" level="20" quality="20" enabled="true" /><Gem nameSpec="Martial Tempo" level="20" support="true" enabled="true" /></Skill>
      <Skill slot="2" label="Tempest Flurry" enabled="true"><Gem nameSpec="Tempest Flurry" level="20" quality="20" enabled="true" /></Skill>
    </PathOfBuilding2>`;
    const right = `<PathOfBuilding2>
      <Build characterName="OrderB" className="Monk" ascendClassName="Martial Artist" level="96" />
      <Skill slot="1" label="Tempest Flurry" enabled="true"><Gem nameSpec="Tempest Flurry" level="20" quality="20" enabled="true" /></Skill>
      <Skill slot="2" label="Ice Strike" enabled="true"><Gem nameSpec="Martial Tempo" level="20" support="true" enabled="true" /><Gem nameSpec="Ice Strike" level="20" quality="20" enabled="true" /></Skill>
    </PathOfBuilding2>`;

    const a = await postJson("/api/build/import", { source: "pob-xml", label: "Order A", payload: left });
    const b = await postJson("/api/build/import", { source: "pob-xml", label: "Order B", payload: right });
    const { data } = await postJson("/api/build/compare", { baseId: a.data.snapshot.id, targetId: b.data.snapshot.id });

    // Both skills are present on both sides — nothing added or removed...
    expect(data.skills.counts.added ?? 0).toBe(0);
    expect(data.skills.counts.removed ?? 0).toBe(0);
    // ...and the reorder (groups and gems) is not a change.
    expect(data.skills.counts.changed ?? 0).toBe(0);

    await fetch(`http://localhost:${pobaiPort}/api/build/${a.data.snapshot.id}`, { method: "DELETE" });
    await fetch(`http://localhost:${pobaiPort}/api/build/${b.data.snapshot.id}`, { method: "DELETE" });
  });
});
