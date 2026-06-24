import React from "react";
import { type StatChange, type Tone, asArray, displayValue, isNear, statTone } from "../diff-utils";

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
