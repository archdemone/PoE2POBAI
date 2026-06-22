import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSummary } from "./pob-parser.js";

export interface BuildSnapshot {
  id: string;
  source: "pob-code" | "pob-xml" | "manual";
  createdAt: string;
  label: string;
  hash: string;
  sizeBytes: number;
  preview: string;
  summary: BuildSummary;
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

}
