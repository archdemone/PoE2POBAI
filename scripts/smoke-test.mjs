const baseUrl = process.env.POBAI_SMOKE_BASE_URL ?? "http://localhost:3001";
const samplePayload = `<PathOfBuilding2>
  <Build characterName="Smoke Twister" className="Ranger" ascendClassName="Deadeye" level="72" />
  <Skills>
    <Skill label="Twister main setup"><Gem nameSpec="Twister" level="18" /><Gem nameSpec="Trinity Support" support="true" level="17" /></Skill>
  </Skills>
  <Items><Item id="1" slot="Weapon 1"><Name>Smoke Bow</Name><TypeLine>Expert Bow</TypeLine></Item></Items>
  <PlayerStat stat="Life" value="1450" />
  <PlayerStat stat="Cold Resistance" value="38" />
  <Tree treeVersion="demo"><Node id="101" /></Tree>
</PathOfBuilding2>`;

async function expectOk(label, promise) {
  const response = await promise;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${text}`);
  }
  const data = text ? JSON.parse(text) : null;
  console.log(`ok - ${label}`);
  return data;
}

const health = await expectOk("health", fetch(`${baseUrl}/health`));
if (!health.ok || !health.dependencyFree) {
  throw new Error("Health response did not report dependency-free server mode.");
}

const imported = await expectOk("snapshot import", fetch(`${baseUrl}/api/build/import`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    source: "pob-xml",
    label: `Smoke Test Snapshot ${Date.now()}`,
    payload: samplePayload,
  }),
}));

if (!imported.snapshot?.id || !imported.snapshot?.hash) {
  throw new Error("Snapshot import did not return id/hash metadata.");
}
if (imported.snapshot.summary?.character?.className !== "Ranger") {
  throw new Error("Snapshot parser did not extract className from XML.");
}
if (!imported.snapshot.summary?.skills?.some((skill) => skill.label.includes("Twister"))) {
  throw new Error("Snapshot parser did not extract Twister skill group.");
}
if (imported.snapshot.summary?.defenses?.Life !== "1450") {
  throw new Error("Snapshot parser did not extract defense-like Life stat.");
}

const current = await expectOk("snapshot list", fetch(`${baseUrl}/api/build/current`));
if (!current.snapshots?.some((snapshot) => snapshot.id === imported.snapshot.id)) {
  throw new Error("Snapshot list did not include imported snapshot.");
}

const summary = await expectOk("snapshot summary", fetch(`${baseUrl}/api/build/${imported.snapshot.id}/summary`));
if (summary.snapshot.id !== imported.snapshot.id) {
  throw new Error("Snapshot summary endpoint returned the wrong snapshot.");
}

const chat = await expectOk("demo chat", fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    apiKey: "",
    model: "demo/local",
    snapshotId: imported.snapshot.id,
    messages: [{ role: "user", content: "Why are my defenses low?" }],
  }),
}));

if (!chat.message?.content?.includes("Extracted defense-like stats")) {
  throw new Error("Demo chat did not return grounded defense response.");
}
if (chat.message?.evidence?.questionType !== "defense") {
  throw new Error("Demo chat did not return defense evidence metadata.");
}
if (!chat.message?.evidence?.extracted?.some((value) => value.includes("Life=1450"))) {
  throw new Error("Evidence metadata did not include extracted Life stat.");
}

const deleted = await expectOk("snapshot delete", fetch(`${baseUrl}/api/build/${imported.snapshot.id}`, { method: "DELETE" }));
if (!deleted.deleted) {
  throw new Error("Snapshot delete did not report success.");
}

const afterDelete = await expectOk("snapshot list after delete", fetch(`${baseUrl}/api/build/current`));
if (afterDelete.snapshots?.some((snapshot) => snapshot.id === imported.snapshot.id)) {
  throw new Error("Snapshot list still included deleted snapshot.");
}

console.log("PoBAI smoke test passed.");
