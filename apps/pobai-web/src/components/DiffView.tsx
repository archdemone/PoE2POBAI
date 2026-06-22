import React from "react";

interface SkillChange {
  label?: string;
  name?: string;
  gems?: Array<string | { name?: string; label?: string; gemId?: string; skillId?: string }>;
}

interface ItemChange {
  slot?: string;
  name?: string;
  typeLine?: string;
}

interface StatChange {
  label?: string;
  from?: unknown;
  to?: unknown;
  base?: unknown;
  target?: unknown;
  baseValue?: unknown;
  targetValue?: unknown;
  baseRaw?: unknown;
  targetRaw?: unknown;
  delta?: unknown;
  percent?: unknown;
  percentDelta?: unknown;
  better?: boolean;
  color?: "green" | "red" | "neutral";
  impact?: "better" | "worse" | "changed" | "neutral";
  changed?: boolean;
  status?: "added" | "removed" | "changed" | "unchanged";
}

interface ChangedPair<T> {
  label?: string;
  slot?: string;
  from?: T | string;
  to?: T | string;
  base?: T | string;
  target?: T | string;
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
}

interface CollectionComparison<T> {
  rows?: Array<CollectionRow<T>>;
}

interface PassiveTreeComparison {
  addedNodeIds?: string[];
  removedNodeIds?: string[];
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
  statsChanged?: Record<string, StatChange> | StatChange[];
  statDiffs?: Record<string, StatChange> | StatChange[];
  passivesChanged?: PassivesChange;
  passiveTree?: PassiveTreeComparison;
  textPatch?: string;
}

interface NormalizedStat {
  label: string;
  from: string;
  to: string;
  delta: string;
  tone: "positive" | "negative" | "neutral";
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(none)";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.name ?? record.label ?? record.typeLine ?? record.id;
    if (preferred !== undefined) return displayValue(preferred);
    return JSON.stringify(value);
  }
  return String(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function statTone(change: StatChange): NormalizedStat["tone"] {
  if (change.color === "green" || change.impact === "better") return "positive";
  if (change.color === "red" || change.impact === "worse") return "negative";
  if (change.better === true) return "positive";
  if (change.better === false) return "negative";
  const explicitDelta = numericValue(change.delta);
  if (explicitDelta !== null) return explicitDelta > 0 ? "positive" : explicitDelta < 0 ? "negative" : "neutral";
  const from = numericValue(change.from ?? change.base);
  const to = numericValue(change.to ?? change.target);
  if (from === null || to === null) return "neutral";
  return to > from ? "positive" : to < from ? "negative" : "neutral";
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
    .map(([label, change]) => {
      const deltaText = formatDelta(change);
      return {
        label,
        from: displayValue(change.from ?? change.base ?? change.baseRaw ?? change.baseValue),
        to: displayValue(change.to ?? change.target ?? change.targetRaw ?? change.targetValue),
        delta: deltaText,
        tone: statTone(change),
      };
    });
}

function formatSignedNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function formatDelta(change: StatChange): string {
  const delta = numericValue(change.delta);
  const percent = numericValue(change.percentDelta ?? change.percent);
  const parts = [];
  if (delta !== null) parts.push(formatSignedNumber(delta));
  if (percent !== null) parts.push(`${formatSignedNumber(percent)}%`);
  if (parts.length > 0) return parts.join(" / ");
  if (change.delta !== undefined) return displayValue(change.delta);
  if (change.percentDelta !== undefined) return `${displayValue(change.percentDelta)}%`;
  if (change.percent !== undefined) return `${displayValue(change.percent)}%`;
  return "";
}

function skillLabel(skill: SkillChange): string {
  return skill.label ?? skill.name ?? "Unknown skill";
}

function skillDetail(skill: SkillChange): string {
  return asArray(skill.gems).map((gem) => displayValue(gem)).join(", ");
}

function itemLabel(item: ItemChange): string {
  return item.slot ?? "Unknown slot";
}

function itemDetail(item: ItemChange): string {
  return [item.name, item.typeLine].filter(Boolean).join(" - ");
}

function pairFrom<T>(pair: ChangedPair<T>): T | string | undefined {
  return pair.from ?? pair.base;
}

function pairTo<T>(pair: ChangedPair<T>): T | string | undefined {
  return pair.to ?? pair.target;
}

function backendRows<T>(comparison: CollectionComparison<T> | undefined, status: CollectionRow<T>["status"]): Array<CollectionRow<T>> {
  return asArray(comparison?.rows).filter((row) => row.status === status);
}

function skillFromRow(row: CollectionRow<SkillChange>, side: "base" | "target"): SkillChange {
  return (side === "base" ? row.base : row.target) ?? { label: row.key ?? "Unknown skill" };
}

function itemFromRow(row: CollectionRow<ItemChange>, side: "base" | "target"): ItemChange {
  return (side === "base" ? row.base : row.target) ?? { slot: row.key ?? "Unknown slot" };
}

function skillChangePairs(diff: BuildCompareResult): Array<ChangedPair<SkillChange>> {
  const legacy = asArray(diff.skillsChanged);
  const backend = backendRows(diff.skills, "changed").map((row) => ({
    label: skillLabel(skillFromRow(row, "target")),
    from: skillFromRow(row, "base"),
    to: skillFromRow(row, "target"),
  }));
  return [...legacy, ...backend];
}

function itemChangePairs(diff: BuildCompareResult): Array<ChangedPair<ItemChange>> {
  const legacy = asArray(diff.itemsChanged);
  const backend = backendRows(diff.items, "changed").map((row) => ({
    slot: itemFromRow(row, "target").slot ?? itemFromRow(row, "base").slot,
    from: itemFromRow(row, "base"),
    to: itemFromRow(row, "target"),
  }));
  return [...legacy, ...backend];
}

export function DiffView({ diff }: { diff: BuildCompareResult }) {
  const skillsAdded = [...asArray(diff.skillsAdded), ...backendRows(diff.skills, "added").map((row) => skillFromRow(row, "target"))];
  const skillsRemoved = [...asArray(diff.skillsRemoved), ...backendRows(diff.skills, "removed").map((row) => skillFromRow(row, "base"))];
  const skillsChanged = skillChangePairs(diff);
  const itemsAdded = [...asArray(diff.itemsAdded), ...backendRows(diff.items, "added").map((row) => itemFromRow(row, "target"))];
  const itemsRemoved = [...asArray(diff.itemsRemoved), ...backendRows(diff.items, "removed").map((row) => itemFromRow(row, "base"))];
  const itemsChanged = itemChangePairs(diff);
  const stats = normalizeStatRecords(diff);
  const passivesChanged = diff.passivesChanged ?? {};
  const nodesAdded = passivesChanged.nodesAdded ?? passivesChanged.added?.length ?? diff.passiveTree?.addedNodeIds?.length ?? 0;
  const nodesRemoved = passivesChanged.nodesRemoved ?? passivesChanged.removed?.length ?? diff.passiveTree?.removedNodeIds?.length ?? 0;

  const hasChanges =
    skillsAdded.length > 0 ||
    skillsRemoved.length > 0 ||
    skillsChanged.length > 0 ||
    itemsAdded.length > 0 ||
    itemsRemoved.length > 0 ||
    itemsChanged.length > 0 ||
    stats.length > 0 ||
    nodesAdded > 0 ||
    nodesRemoved > 0;

  if (!hasChanges) {
    return <div className="diff-view diff-empty">No differences between these builds.</div>;
  }

  return (
    <div className="diff-view">
      <div className="copy-summary">
        <strong>Copy checklist</strong>
        <span>Values compare the build to copy against your build.</span>
      </div>

      {stats.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Stat differences</h4>
          <div className="stat-diff-table">
            {stats.map((stat) => (
              <div key={stat.label} className="stat-diff-row">
                <span className="stat-label">{stat.label}</span>
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
              {skillDetail(skill) && <span className="diff-item-detail">{skillDetail(skill)}</span>}
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
              {skillDetail(skill) && <span className="diff-item-detail">{skillDetail(skill)}</span>}
            </div>
          ))}
        </div>
      )}

      {skillsChanged.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Skills to update</h4>
          {skillsChanged.map((skill, i) => (
            <div key={`${skill.label ?? "skill"}-${i}`} className="diff-item diff-item-changed">
              <span className="diff-item-label">{skill.label ?? "Skill"}</span>
              <span className="diff-item-detail">{displayValue(pairFrom(skill))} -&gt; {displayValue(pairTo(skill))}</span>
            </div>
          ))}
        </div>
      )}

      {itemsRemoved.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-removed">Items only in my build ({itemsRemoved.length})</h4>
          {itemsRemoved.map((item, i) => (
            <div key={`${itemLabel(item)}-${i}`} className="diff-item diff-item-removed">
              <span className="diff-item-label">{itemLabel(item)}</span>
              {itemDetail(item) && <span className="diff-item-detail">{itemDetail(item)}</span>}
            </div>
          ))}
        </div>
      )}

      {itemsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Items to equip from target ({itemsAdded.length})</h4>
          {itemsAdded.map((item, i) => (
            <div key={`${itemLabel(item)}-${i}`} className="diff-item diff-item-added">
              <span className="diff-item-label">{itemLabel(item)}</span>
              {itemDetail(item) && <span className="diff-item-detail">{itemDetail(item)}</span>}
            </div>
          ))}
        </div>
      )}

      {itemsChanged.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Items to swap</h4>
          {itemsChanged.map((item, i) => (
            <div key={`${item.slot ?? item.label ?? "item"}-${i}`} className="diff-item diff-item-changed">
              <span className="diff-item-label">{item.slot ?? item.label ?? "Item"}</span>
              <span className="diff-item-detail">{displayValue(pairFrom(item))} -&gt; {displayValue(pairTo(item))}</span>
            </div>
          ))}
        </div>
      )}

      {(nodesAdded > 0 || nodesRemoved > 0) && (
        <div className="diff-section">
          <h4 className="diff-heading">Passive tree to copy</h4>
          <div className="diff-item">
            {nodesAdded > 0 && <span className="diff-item-added">+{nodesAdded} nodes</span>}
            {nodesRemoved > 0 && <span className="diff-item-removed">-{nodesRemoved} nodes</span>}
          </div>
        </div>
      )}
    </div>
  );
}
