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
});
