import React from "react";

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

interface ItemDiffData {
  properties?: StatChange[];
  modsAdded?: string[];
  modsRemoved?: string[];
  modsChanged?: Array<{ from?: string; to?: string }>;
}

interface CollectionRow {
  key?: string;
  status?: "added" | "removed" | "changed" | "unchanged";
  changed?: boolean;
  base?: ItemChange | null;
  target?: ItemChange | null;
  itemDiff?: ItemDiffData;
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

type Tone = "positive" | "negative" | "neutral";

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

function itemTitle(item: ItemChange | string | null | undefined, fallbackSlot?: string): string {
  if (!item) return fallbackSlot ?? "Item";
  if (typeof item === "string") return item;
  return [item.slot, item.name].filter(Boolean).join(": ") || item.typeLine || fallbackSlot || "Item";
}

function itemSubtitle(item: ItemChange | string | null | undefined): string {
  if (!item || typeof item === "string") return "";
  return [item.name, item.typeLine].filter(Boolean).join(" - ");
}

export function ItemChangeRow({ row }: { row: CollectionRow }) {
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
