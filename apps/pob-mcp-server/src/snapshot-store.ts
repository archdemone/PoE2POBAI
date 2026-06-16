import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSummary } from "./pob-parser.js";
import { computeDiff } from "./diff-engine.js";
import { applyPatch } from "./patch-applier.js";

export interface BuildSnapshot {
  id: string;
  source: "pob-code" | "pob-xml" | "manual";
  createdAt: string;
  label: string;
  hash: string;
  sizeBytes: number;
  preview: string;
  summary: BuildSummary;
  parentId?: string;
  patchPath?: string;
}

export interface SnapshotDiff {
  baseId: string;
  targetId: string;
  skillsAdded: Array<{ label: string; gems: string[] }>;
  skillsRemoved: Array<{ label: string; gems: string[] }>;
  itemsAdded: Array<{ slot?: string; name?: string }>;
  itemsRemoved: Array<{ slot?: string; name?: string }>;
  defensesChanged: Record<string, { from?: string; to?: string }>;
  passivesChanged: { nodesAdded: number; nodesRemoved: number };
  textPatch?: string;
}

export interface LineageEntry {
  id: string;
  label: string;
  createdAt: string;
  parentId?: string;
}

const DEFAULT_DATA_DIR = fileURLToPath(
  new URL("../../../../data/snapshots", import.meta.url)
);

export class SnapshotStore {
  private readonly dataDir: string;
  private readonly cache = new Map<string, BuildSnapshot>();
  private initialized = false;

  constructor(dataDir: string = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dataDir, { recursive: true });
    const entries = await readdir(this.dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.dataDir, entry.name), "utf8");
        const snapshot = JSON.parse(raw) as BuildSnapshot;
        if (snapshot?.id) this.cache.set(snapshot.id, snapshot);
      } catch {
        // skip corrupt entries
      }
    }
    this.initialized = true;
  }

  list(): BuildSnapshot[] {
    return [...this.cache.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  get(id: string): BuildSnapshot | undefined {
    return this.cache.get(id);
  }

  async save(
    xml: string,
    summary: BuildSummary,
    label?: string,
    source: BuildSnapshot["source"] = "pob-xml"
  ): Promise<BuildSnapshot> {
    const hash = createHash("sha256").update(xml).digest("hex");
    const snapshot: BuildSnapshot = {
      id: randomUUID(),
      source,
      createdAt: new Date().toISOString(),
      label: label?.trim() || `Build ${new Date().toISOString()}`,
      hash,
      sizeBytes: Buffer.byteLength(xml, "utf8"),
      preview: xml.slice(0, 240),
      summary,
    };
    this.cache.set(snapshot.id, snapshot);
    await mkdir(this.dataDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(this.dataDir, `${snapshot.id}.json`),
        JSON.stringify(snapshot, null, 2),
        "utf8"
      ),
      writeFile(join(this.dataDir, `${snapshot.id}.payload.txt`), xml, "utf8"),
    ]);
    return snapshot;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.cache.has(id)) return false;
    this.cache.delete(id);
    for (const file of [`${id}.json`, `${id}.payload.txt`]) {
      try {
        await unlink(join(this.dataDir, file));
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
      }
    }
    return true;
  }

  async getPayload(id: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.dataDir, `${id}.payload.txt`), "utf8");
    } catch {
      return undefined;
    }
  }

  async clone(id: string, label?: string): Promise<BuildSnapshot | undefined> {
    const original = this.cache.get(id);
    if (!original) return undefined;
    const payload = await this.getPayload(id);
    if (!payload) return undefined;
    const summary = { ...original.summary };
    const snapshot: BuildSnapshot = {
      id: randomUUID(),
      source: original.source,
      createdAt: new Date().toISOString(),
      label: label?.trim() || `${original.label} (clone)`,
      hash: original.hash,
      sizeBytes: original.sizeBytes,
      preview: original.preview,
      summary,
      parentId: id,
    };
    this.cache.set(snapshot.id, snapshot);
    await mkdir(this.dataDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(this.dataDir, `${snapshot.id}.json`),
        JSON.stringify(snapshot, null, 2),
        "utf8"
      ),
      writeFile(join(this.dataDir, `${snapshot.id}.payload.txt`), payload, "utf8"),
    ]);
    return snapshot;
  }

  async diff(id1: string, id2: string): Promise<SnapshotDiff | undefined> {
    const s1 = this.cache.get(id1);
    const s2 = this.cache.get(id2);
    if (!s1 || !s2) return undefined;
    const [p1, p2] = await Promise.all([this.getPayload(id1), this.getPayload(id2)]);
    if (!p1 || !p2) return undefined;
    return computeDiff(p1, p2, id1, id2);
  }

  getLineage(id: string): LineageEntry[] {
    const entries: LineageEntry[] = [];
    let current = this.cache.get(id);
    while (current) {
      entries.push({
        id: current.id,
        label: current.label,
        createdAt: current.createdAt,
        parentId: current.parentId,
      });
      current = current.parentId ? this.cache.get(current.parentId) ?? undefined : undefined;
    }
    return entries;
  }

  async applyPatch(id: string, patchStr: string, label?: string): Promise<BuildSnapshot | undefined> {
    const original = this.cache.get(id);
    if (!original) return undefined;
    const payload = await this.getPayload(id);
    if (!payload) return undefined;
    const newPayload = applyPatch(payload, patchStr);
    if (!newPayload) return undefined;
    const { parseBuildXml } = await import("./pob-parser.js");
    const summary = parseBuildXml(newPayload);
    const hash = createHash("sha256").update(newPayload).digest("hex");
    const snapshot: BuildSnapshot = {
      id: randomUUID(),
      source: original.source,
      createdAt: new Date().toISOString(),
      label: label?.trim() || `${original.label} (patched)`,
      hash,
      sizeBytes: Buffer.byteLength(newPayload, "utf8"),
      preview: newPayload.slice(0, 240),
      summary,
      parentId: id,
      patchPath: patchStr.slice(0, 120),
    };
    this.cache.set(snapshot.id, snapshot);
    await mkdir(this.dataDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(this.dataDir, `${snapshot.id}.json`),
        JSON.stringify(snapshot, null, 2),
        "utf8"
      ),
      writeFile(join(this.dataDir, `${snapshot.id}.payload.txt`), newPayload, "utf8"),
    ]);
    return snapshot;
  }
}
