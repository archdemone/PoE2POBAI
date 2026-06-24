import React from "react";
import { SkillChangeRow } from "./SkillDiff";
import { ItemChangeRow } from "./ItemDiff";
import { NodeGroups } from "./PassiveDiff";
import {
  type StatChange, type Tone, type NormalizedStat,
  asArray, displayValue, isNear, statTone, formatDelta,
} from "../diff-utils";

interface Gem {
  name?: string;
  level?: string | number;
  quality?: string | number;
  support?: unknown;
  enabled?: unknown;
}

interface SkillChange {
  label?: string;
  name?: string;
  gems?: Array<string | Gem>;
}

interface ItemChange {
  slot?: string;
  name?: string;
  typeLine?: string;
  rarity?: string;
  itemLevel?: string | number;
  quality?: string | number;
  sockets?: string;
  mods?: string[];
}

interface ChangedPair<T> {
  label?: string;
  slot?: string;
  from?: T | string;
  to?: T | string;
  base?: T | string;
  target?: T | string;
}

interface GemDiff {
  added?: Gem[];
  removed?: Gem[];
  changed?: Array<{ name?: string; base?: Gem; target?: Gem; level?: StatChange; quality?: StatChange }>;
}

interface ItemDiff {
  properties?: StatChange[];
  modsAdded?: string[];
  modsRemoved?: string[];
  modsChanged?: Array<{ from?: string; to?: string }>;
}

interface PassivesChange {
  nodesAdded?: number;
  nodesRemoved?: number;
  added?: unknown[];
  removed?: unknown[];
}

interface CollectionRow<T> {
  key?: string;
  status?: "added" | "removed" | "changed" | "unchanged";
  changed?: boolean;
  base?: T | null;
  target?: T | null;
  gemDiff?: GemDiff;
  itemDiff?: ItemDiff;
}

interface CollectionComparison<T> {
  rows?: Array<CollectionRow<T>>;
}

interface TreeNode {
  id: string;
  name: string;
  type: "keystone" | "notable" | "mastery" | "ascendancy" | "jewel" | "small" | "unknown";
  stats?: string[];
  ascendancy?: string;
}

interface NodeDescription {
  groups?: Partial<Record<TreeNode["type"], TreeNode[]>>;
  named?: number;
  total?: number;
}

interface PassiveTreeComparison {
  addedNodeIds?: string[];
  removedNodeIds?: string[];
  sharedNodeCount?: number;
  url?: StatChange;
  nodesToAllocate?: NodeDescription;
  nodesToRemove?: NodeDescription;
  treeDataVersion?: { version: string; exact: boolean } | null;
}

export interface BuildCompareResult {
  baseId?: string;
  targetId?: string;
  base?: unknown;
  target?: unknown;
  character?: unknown;
  skills?: CollectionComparison<SkillChange>;
  skillsAdded?: SkillChange[];
  skillsRemoved?: SkillChange[];
  skillsChanged?: Array<ChangedPair<SkillChange>>;
  items?: CollectionComparison<ItemChange>;
  itemsAdded?: ItemChange[];
  itemsRemoved?: ItemChange[];
  itemsChanged?: Array<ChangedPair<ItemChange>>;
  defensesChanged?: Record<string, StatChange>;
  defenses?: { stats?: StatChange[] };
  stats?: { rows?: StatChange[]; counts?: Record<string, number>; changed?: boolean };
  statsChanged?: Record<string, StatChange> | StatChange[];
  statDiffs?: Record<string, StatChange> | StatChange[];
  passivesChanged?: PassivesChange;
  passiveTree?: PassiveTreeComparison;
  textPatch?: string;
}

function normalizeStatRecords(diff: BuildCompareResult): NormalizedStat[] {
  const merged = new Map<string, StatChange>();
  const addRecord = (source: Record<string, StatChange> | StatChange[] | undefined) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const change of source) {
        const label = change.label;
        if (label) merged.set(label, change);
      }
      return;
    }
    for (const [label, change] of Object.entries(source)) merged.set(label, { ...change, label });
  };

  addRecord(diff.defensesChanged);
  addRecord(diff.defenses?.stats);
  addRecord(diff.statsChanged);
  addRecord(diff.statDiffs);

  return [...merged.entries()]
    .filter(([, change]) => change.changed !== false && change.status !== "unchanged")
    .map(([label, change]) => ({
      label,
      from: displayValue(change.from ?? change.base ?? change.baseRaw ?? change.baseValue),
      to: displayValue(change.to ?? change.target ?? change.targetRaw ?? change.targetValue),
      delta: formatDelta(change),
      tone: statTone(change) as Tone,
      near: isNear(change),
    }));
}

function backendRows<T>(comparison: CollectionComparison<T> | undefined, status: CollectionRow<T>["status"]): Array<CollectionRow<T>> {
  return asArray(comparison?.rows).filter((row) => row.status === status);
}

function skillLabel(skill: SkillChange): string {
  return skill.label ?? skill.name ?? "Unknown skill";
}

function skillGems(skill: SkillChange | null | undefined): Gem[] {
  if (!skill) return [];
  return asArray(skill.gems).map((gem) => (typeof gem === "string" ? { name: gem } : gem));
}

export function DiffView({ diff, showStats = true }: { diff: BuildCompareResult; showStats?: boolean }) {
  const skillsAdded = [...asArray(diff.skillsAdded), ...backendRows(diff.skills, "added").map((row) => row.target ?? { label: row.key ?? "Unknown skill" })];
  const skillsRemoved = [...asArray(diff.skillsRemoved), ...backendRows(diff.skills, "removed").map((row) => row.base ?? { label: row.key ?? "Unknown skill" })];
  const skillsChangedRows = backendRows(diff.skills, "changed");
  const legacySkillsChanged = asArray(diff.skillsChanged);

  const itemsAdded = [...asArray(diff.itemsAdded), ...backendRows(diff.items, "added").map((row) => row.target ?? { slot: row.key ?? "Unknown slot" })];
  const itemsRemoved = [...asArray(diff.itemsRemoved), ...backendRows(diff.items, "removed").map((row) => row.base ?? { slot: row.key ?? "Unknown slot" })];
  const itemsChangedRows = backendRows(diff.items, "changed");
  const legacyItemsChanged = asArray(diff.itemsChanged);

  const stats = showStats ? normalizeStatRecords(diff) : [];
  const passivesChanged = diff.passivesChanged ?? {};
  const nodesAdded = passivesChanged.nodesAdded ?? passivesChanged.added?.length ?? diff.passiveTree?.addedNodeIds?.length ?? 0;
  const nodesRemoved = passivesChanged.nodesRemoved ?? passivesChanged.removed?.length ?? diff.passiveTree?.removedNodeIds?.length ?? 0;
  const sharedNodes = diff.passiveTree?.sharedNodeCount;
  const baseTreeUrl = (diff.passiveTree?.url?.baseValue ?? diff.passiveTree?.url?.base) as string | undefined;
  const targetTreeUrl = (diff.passiveTree?.url?.targetValue ?? diff.passiveTree?.url?.target) as string | undefined;
  const treeData = diff.passiveTree?.treeDataVersion;
  const allocNamed = diff.passiveTree?.nodesToAllocate?.named ?? 0;
  const removeNamed = diff.passiveTree?.nodesToRemove?.named ?? 0;
  const treeDataNote = !treeData
    ? "Node names need PoB's tree data — open both trees to line them up visually."
    : !treeData.exact
      ? `Node details shown from tree data ${treeData.version} (closest available to this build's version).`
      : allocNamed === 0 && removeNamed === 0
        ? "Couldn't match these node ids to tree data — open both trees to compare visually."
        : "";

  const skillsChangedCount = skillsChangedRows.length + legacySkillsChanged.length;
  const itemsChangedCount = itemsChangedRows.length + legacyItemsChanged.length;

  const hasChanges =
    skillsAdded.length > 0 || skillsRemoved.length > 0 || skillsChangedCount > 0 ||
    itemsAdded.length > 0 || itemsRemoved.length > 0 || itemsChangedCount > 0 ||
    stats.length > 0 || nodesAdded > 0 || nodesRemoved > 0;

  if (!hasChanges) {
    return <div className="diff-view diff-empty">No differences between these builds.</div>;
  }

  return (
    <div className="diff-view">
      <div className="copy-summary">
        <strong>Copy checklist</strong>
        <span>Green = the build to copy has more. Red = it has less. White = close enough to leave alone.</span>
      </div>

      {stats.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Stat differences</h4>
          <div className="stat-diff-table">
            <div className="stat-diff-row stat-diff-head">
              <span className="stat-label">Stat</span>
              <span className="stat-base">My build</span>
              <span className="stat-target">To copy</span>
              <span className="stat-delta">Δ</span>
            </div>
            {stats.map((stat) => (
              <div key={stat.label} className={`stat-diff-row${stat.near ? " stat-diff-near" : ""}`}>
                <span className="stat-label">{stat.label}{stat.near && <span className="stat-near-tag">≈ matched</span>}</span>
                <span className="stat-base">{stat.from}</span>
                <span className={`stat-target stat-${stat.tone}`}>{stat.to}</span>
                {stat.delta && <span className={`stat-delta stat-${stat.tone}`}>{stat.delta}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {skillsRemoved.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-removed">Skills only in my build ({skillsRemoved.length})</h4>
          {skillsRemoved.map((skill, i) => (
            <div key={`${skillLabel(skill)}-${i}`} className="diff-item diff-item-removed">
              <span className="diff-item-label">{skillLabel(skill)}</span>
              {skillGems(skill).length > 0 && <span className="diff-item-detail">{skillGems(skill).map((g) => `${g.name ?? "Gem"}`).join(", ")}</span>}
            </div>
          ))}
        </div>
      )}

      {skillsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Skills to add from target ({skillsAdded.length})</h4>
          {skillsAdded.map((skill, i) => (
            <div key={`${skillLabel(skill)}-${i}`} className="diff-item diff-item-added">
              <span className="diff-item-label">{skillLabel(skill)}</span>
              {skillGems(skill).length > 0 && <span className="diff-item-detail">{skillGems(skill).map((g) => `${g.name ?? "Gem"}`).join(", ")}</span>}
            </div>
          ))}
        </div>
      )}

      {skillsChangedCount > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Skill groups to update ({skillsChangedCount})</h4>
          {skillsChangedRows.map((row, i) => (
            <SkillChangeRow key={`row-${row.key ?? i}`} row={row} />
          ))}
          {legacySkillsChanged.map((pair, i) => (
            <div key={`legacy-skill-${i}`} className="diff-item diff-item-changed">
              <span className="diff-item-label">{pair.label ?? "Skill"}</span>
              <span className="diff-item-detail">{displayValue(pair.from ?? pair.base)} -&gt; {displayValue(pair.to ?? pair.target)}</span>
            </div>
          ))}
        </div>
      )}

      {itemsRemoved.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-removed">Items only in my build ({itemsRemoved.length})</h4>
          {itemsRemoved.map((item, i) => (
            <div key={`${item.slot ?? item.name ?? i}`} className="diff-item diff-item-removed">
              <span className="diff-item-label">{[item.slot, item.name].filter(Boolean).join(": ") || item.typeLine || "Item"}</span>
              {[item.name, item.typeLine].filter(Boolean).join(" - ") && (
                <span className="diff-item-detail">{[item.name, item.typeLine].filter(Boolean).join(" - ")}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {itemsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Items to equip from target ({itemsAdded.length})</h4>
          {itemsAdded.map((item, i) => (
            <div key={`${item.slot ?? item.name ?? i}`} className="diff-item diff-item-added">
              <span className="diff-item-label">{[item.slot, item.name].filter(Boolean).join(": ") || item.typeLine || "Item"}</span>
              {[item.name, item.typeLine].filter(Boolean).join(" - ") && (
                <span className="diff-item-detail">{[item.name, item.typeLine].filter(Boolean).join(" - ")}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {itemsChangedCount > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Items to swap ({itemsChangedCount})</h4>
          {itemsChangedRows.map((row, i) => (
            <ItemChangeRow key={`item-row-${row.key ?? i}`} row={row} />
          ))}
          {legacyItemsChanged.map((pair, i) => (
            <div key={`legacy-item-${i}`} className="diff-item diff-item-changed">
              <span className="diff-item-label">{pair.slot ?? pair.label ?? "Item"}</span>
              <span className="diff-item-detail">{displayValue(pair.from ?? pair.base)} -&gt; {displayValue(pair.to ?? pair.target)}</span>
            </div>
          ))}
        </div>
      )}

      {(nodesAdded > 0 || nodesRemoved > 0) && (
        <div className="diff-section">
          <h4 className="diff-heading">Passive tree to copy</h4>
          <div className="diff-item diff-item-changed">
            <span className="diff-item-label">
              {nodesAdded > 0 && <span className="gem-added">+{nodesAdded} nodes</span>}
              {nodesAdded > 0 && nodesRemoved > 0 && " · "}
              {nodesRemoved > 0 && <span className="gem-removed">-{nodesRemoved} nodes</span>}
            </span>
            {typeof sharedNodes === "number" && <span className="diff-item-detail">{sharedNodes} nodes already shared</span>}
          </div>

          <NodeGroups title="Allocate (in the build to copy)" tone="added" desc={diff.passiveTree?.nodesToAllocate} />
          <NodeGroups title="Remove (only in my build)" tone="removed" desc={diff.passiveTree?.nodesToRemove} />

          {(baseTreeUrl || targetTreeUrl) && (
            <div className="tree-links">
              {baseTreeUrl && <a href={baseTreeUrl} target="_blank" rel="noreferrer">Open my tree</a>}
              {targetTreeUrl && <a href={targetTreeUrl} target="_blank" rel="noreferrer">Open tree to copy</a>}
            </div>
          )}
          {treeDataNote && <span className="diff-note">{treeDataNote}</span>}
        </div>
      )}
    </div>
  );
}
