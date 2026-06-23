import React from "react";

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

interface StatChange {
  key?: string;
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
  near?: boolean;
  color?: "green" | "red" | "neutral";
  impact?: "better" | "worse" | "changed" | "neutral";
  changed?: boolean;
  status?: "added" | "removed" | "changed" | "unchanged" | "near";
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

type Tone = "positive" | "negative" | "neutral";

interface NormalizedStat {
  label: string;
  from: string;
  to: string;
  delta: string;
  tone: Tone;
  near: boolean;
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

function isNear(change: StatChange): boolean {
  return change.near === true || change.status === "near";
}

function statTone(change: StatChange): Tone {
  if (isNear(change)) return "neutral";
  if (change.color === "green" || change.impact === "better") return "positive";
  if (change.color === "red" || change.impact === "worse") return "negative";
  if (change.better === true) return "positive";
  if (change.better === false) return "negative";
  if (change.impact === "neutral") return "neutral";
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
    .map(([label, change]) => ({
      label,
      from: displayValue(change.from ?? change.base ?? change.baseRaw ?? change.baseValue),
      to: displayValue(change.to ?? change.target ?? change.targetRaw ?? change.targetValue),
      delta: formatDelta(change),
      tone: statTone(change),
      near: isNear(change),
    }));
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

function gemName(gem: string | Gem | undefined): string {
  if (!gem) return "Gem";
  if (typeof gem === "string") return gem;
  return gem.name ?? "Gem";
}

function gemMeta(gem: string | Gem | undefined): string {
  if (!gem || typeof gem === "string") return "";
  const bits: string[] = [];
  if (gem.level !== undefined && gem.level !== null && gem.level !== "") bits.push(`L${gem.level}`);
  if (gem.quality !== undefined && gem.quality !== null && gem.quality !== "" && String(gem.quality) !== "0") bits.push(`Q${gem.quality}`);
  return bits.length ? ` (${bits.join(" / ")})` : "";
}

function gemText(gem: string | Gem | undefined): string {
  return `${gemName(gem)}${gemMeta(gem)}`;
}

function skillGems(skill: SkillChange | string | null | undefined): Gem[] {
  if (!skill || typeof skill === "string") return [];
  return asArray(skill.gems).map((gem) => (typeof gem === "string" ? { name: gem } : gem));
}

function normKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Client-side gem diff used when the backend didn't attach one (legacy shape / tests).
function computeGemDiff(base: Gem[], target: Gem[]): GemDiff {
  const baseByKey = new Map(base.map((g) => [normKey(g.name), g]));
  const targetByKey = new Map(target.map((g) => [normKey(g.name), g]));
  const added: Gem[] = [];
  const removed: Gem[] = [];
  const changed: GemDiff["changed"] = [];
  for (const [key, gem] of targetByKey) if (!baseByKey.has(key)) added.push(gem);
  for (const [key, gem] of baseByKey) if (!targetByKey.has(key)) removed.push(gem);
  for (const [key, t] of targetByKey) {
    const b = baseByKey.get(key);
    if (!b) continue;
    if (String(b.level ?? "") !== String(t.level ?? "") || String(b.quality ?? "") !== String(t.quality ?? "")) {
      changed!.push({ name: t.name, base: b, target: t });
    }
  }
  return { added, removed, changed };
}

function gemDiffEmpty(diff: GemDiff | undefined): boolean {
  if (!diff) return true;
  return asArray(diff.added).length === 0 && asArray(diff.removed).length === 0 && asArray(diff.changed).length === 0;
}

function itemTitle(item: ItemChange | string | null | undefined, fallbackSlot?: string): string {
  if (!item) return fallbackSlot ?? "Item";
  if (typeof item === "string") return item;
  return [item.slot, item.name].filter(Boolean).join(": ") || item.typeLine || fallbackSlot || "Item";
}

function itemSubtitle(item: ItemChange | string | null | undefined): string {
  if (!item || typeof item === "string") return "";
  return [item.name, item.typeLine].filter(Boolean).join(" - ");
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

export function DiffView({ diff, showStats = true }: { diff: BuildCompareResult; showStats?: boolean }) {
  const skillsAdded = [...asArray(diff.skillsAdded), ...backendRows(diff.skills, "added").map((row) => skillFromRow(row, "target"))];
  const skillsRemoved = [...asArray(diff.skillsRemoved), ...backendRows(diff.skills, "removed").map((row) => skillFromRow(row, "base"))];
  const skillsChangedRows = backendRows(diff.skills, "changed");
  const legacySkillsChanged = asArray(diff.skillsChanged);

  const itemsAdded = [...asArray(diff.itemsAdded), ...backendRows(diff.items, "added").map((row) => itemFromRow(row, "target"))];
  const itemsRemoved = [...asArray(diff.itemsRemoved), ...backendRows(diff.items, "removed").map((row) => itemFromRow(row, "base"))];
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
              {skillGems(skill).length > 0 && <span className="diff-item-detail">{skillGems(skill).map(gemText).join(", ")}</span>}
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
              {skillGems(skill).length > 0 && <span className="diff-item-detail">{skillGems(skill).map(gemText).join(", ")}</span>}
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
            <div key={`${itemTitle(item)}-${i}`} className="diff-item diff-item-removed">
              <span className="diff-item-label">{itemTitle(item)}</span>
              {itemSubtitle(item) && <span className="diff-item-detail">{itemSubtitle(item)}</span>}
            </div>
          ))}
        </div>
      )}

      {itemsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Items to equip from target ({itemsAdded.length})</h4>
          {itemsAdded.map((item, i) => (
            <div key={`${itemTitle(item)}-${i}`} className="diff-item diff-item-added">
              <span className="diff-item-label">{itemTitle(item)}</span>
              {itemSubtitle(item) && <span className="diff-item-detail">{itemSubtitle(item)}</span>}
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

function SkillChangeRow({ row }: { row: CollectionRow<SkillChange> }) {
  const label = skillLabel(skillFromRow(row, "target"));
  const baseGems = skillGems(row.base);
  const targetGems = skillGems(row.target);
  const gemDiff = !gemDiffEmpty(row.gemDiff) ? row.gemDiff! : computeGemDiff(baseGems, targetGems);
  const added = asArray(gemDiff.added);
  const removed = asArray(gemDiff.removed);
  const changed = asArray(gemDiff.changed);

  return (
    <div className="diff-item diff-item-changed diff-item-block">
      <span className="diff-item-label">{label}</span>
      <div className="gem-diff">
        {added.map((gem, i) => (
          <span key={`a-${i}`} className="gem-pill gem-added">+ {gemText(gem)}</span>
        ))}
        {removed.map((gem, i) => (
          <span key={`r-${i}`} className="gem-pill gem-removed">− {gemText(gem)}</span>
        ))}
        {changed.map((change, i) => (
          <span key={`c-${i}`} className="gem-pill gem-changed">
            {change.name ?? gemName(change.target)}: {gemMeta(change.base).trim() || "—"} → {gemMeta(change.target).trim() || "—"}
          </span>
        ))}
        {added.length === 0 && removed.length === 0 && changed.length === 0 && (
          <span className="diff-item-detail">{targetGems.map(gemText).join(", ") || "Adjust to match"}</span>
        )}
      </div>
    </div>
  );
}

const NODE_TYPE_LABELS: Record<TreeNode["type"], string> = {
  keystone: "Keystones",
  notable: "Notables",
  mastery: "Masteries",
  ascendancy: "Ascendancy",
  jewel: "Jewel sockets",
  small: "Small passives",
  unknown: "Other nodes",
};
const NODE_TYPE_ORDER: TreeNode["type"][] = ["keystone", "notable", "mastery", "ascendancy", "jewel", "small", "unknown"];

function NodeGroups({ title, tone, desc }: { title: string; tone: "added" | "removed"; desc?: NodeDescription }) {
  const groups = desc?.groups;
  if (!groups || Object.keys(groups).length === 0) return null;
  const sign = tone === "added" ? "+" : "−";
  return (
    <div className="node-groups">
      <h5 className={`node-groups-title gem-${tone}`}>{title}</h5>
      {NODE_TYPE_ORDER.filter((type) => groups[type]?.length).map((type) => (
        <div key={type} className="node-group">
          <span className="node-group-label">{NODE_TYPE_LABELS[type]} ({groups[type]!.length})</span>
          <ul className="node-list">
            {groups[type]!.map((node) => (
              <li key={node.id} className={`node-row node-${type}`}>
                <span className={`node-name gem-${tone}`}>{sign} {node.name}</span>
                {node.stats && node.stats.length > 0 && (
                  <span className="node-stats">{node.stats.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ItemChangeRow({ row }: { row: CollectionRow<ItemChange> }) {
  const title = itemTitle(row.target ?? row.base, row.key);
  const itemDiff = row.itemDiff ?? {};
  const props = asArray(itemDiff.properties);
  const modsAdded = asArray(itemDiff.modsAdded);
  const modsRemoved = asArray(itemDiff.modsRemoved);
  const modsChanged = asArray(itemDiff.modsChanged);
  const baseName = itemSubtitle(row.base);
  const targetName = itemSubtitle(row.target);
  const nothingGranular = props.length === 0 && modsAdded.length === 0 && modsRemoved.length === 0 && modsChanged.length === 0;

  return (
    <div className="diff-item diff-item-changed diff-item-block">
      <span className="diff-item-label">{title}</span>
      {(baseName || targetName) && baseName !== targetName && (
        <span className="diff-item-detail">{baseName || "(none)"} → {targetName || "(none)"}</span>
      )}
      {props.length > 0 && (
        <div className="mod-diff">
          {props.map((prop, i) => (
            <span key={`p-${i}`} className={`mod-pill stat-${statTone(prop)}`}>
              {prop.label}: {displayValue(prop.baseValue ?? prop.baseRaw ?? prop.base)} → {displayValue(prop.targetValue ?? prop.targetRaw ?? prop.target)}
            </span>
          ))}
        </div>
      )}
      {(modsAdded.length > 0 || modsRemoved.length > 0 || modsChanged.length > 0) && (
        <div className="mod-diff">
          {modsAdded.map((mod, i) => <span key={`ma-${i}`} className="mod-pill gem-added">+ {mod}</span>)}
          {modsChanged.map((mod, i) => <span key={`mc-${i}`} className="mod-pill gem-changed">{mod.from} → {mod.to}</span>)}
          {modsRemoved.map((mod, i) => <span key={`mr-${i}`} className="mod-pill gem-removed">− {mod}</span>)}
        </div>
      )}
      {nothingGranular && !baseName && !targetName && (
        <span className="diff-item-detail">Swap to match the build you're copying.</span>
      )}
    </div>
  );
}
