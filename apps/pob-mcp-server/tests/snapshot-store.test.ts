import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore } from "../src/snapshot-store.js";
import { parseBuildXml } from "../src/pob-parser.js";

const SAMPLE_XML = `<PathOfBuilding2>
  <Build className="Ranger" ascendClassName="Deadeye" level="80" />
  <Skills>
    <Skill label="Twister"><Gem nameSpec="Twister" level="20" /></Skill>
  </Skills>
  <PlayerStat stat="Life" value="4000" />
</PathOfBuilding2>`;

let tmpDir: string;
let store: SnapshotStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "pobai-test-"));
  store = new SnapshotStore(tmpDir);
  await store.init();
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
describe("SnapshotStore.save", () => {
  it("saves a snapshot and returns it with an id", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const snapshot = await store.save(SAMPLE_XML, summary, "My Ranger");
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.label).toBe("My Ranger");
    expect(snapshot.source).toBe("pob-xml");
    expect(snapshot.hash).toHaveLength(64); // sha256 hex
  });

  it("generates a default label when none given", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const snapshot = await store.save(SAMPLE_XML, summary);
    expect(snapshot.label).toMatch(/^Build /);
  });

  it("sets sizeBytes to the UTF-8 byte length", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const snapshot = await store.save(SAMPLE_XML, summary);
    expect(snapshot.sizeBytes).toBe(Buffer.byteLength(SAMPLE_XML, "utf8"));
  });
});

describe("SnapshotStore.get", () => {
  it("retrieves a snapshot by id", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const saved = await store.save(SAMPLE_XML, summary, "Test Build");
    const fetched = store.get(saved.id);
    expect(fetched?.id).toBe(saved.id);
    expect(fetched?.label).toBe("Test Build");
  });

  it("returns undefined for unknown id", () => {
    expect(store.get("nonexistent-id")).toBeUndefined();
  });
});

describe("SnapshotStore.list", () => {
  it("returns all saved snapshots sorted newest-first", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const a = await store.save(SAMPLE_XML, summary, "Build A");
    const b = await store.save(SAMPLE_XML, summary, "Build B");
    const list = store.list();
    expect(list).toHaveLength(2);
    // newest first (B was saved after A)
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });
});

describe("SnapshotStore.delete", () => {
  it("removes a snapshot and returns true", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const snapshot = await store.save(SAMPLE_XML, summary, "To Delete");
    const result = await store.delete(snapshot.id);
    expect(result).toBe(true);
    expect(store.get(snapshot.id)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("returns false for unknown id", async () => {
    const result = await store.delete("ghost-id");
    expect(result).toBe(false);
  });
});

describe("SnapshotStore persistence", () => {
  it("loads snapshots from disk on re-init", async () => {
    const summary = parseBuildXml(SAMPLE_XML);
    const saved = await store.save(SAMPLE_XML, summary, "Persisted Build");

    // Create a new store instance pointing at the same directory
    const store2 = new SnapshotStore(tmpDir);
    await store2.init();
    const loaded = store2.get(saved.id);
    expect(loaded?.label).toBe("Persisted Build");
    expect(loaded?.summary.character.className).toBe("Ranger");
  });
});
