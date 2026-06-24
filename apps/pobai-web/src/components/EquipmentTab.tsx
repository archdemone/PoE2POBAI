import React from "react";
import { asArray } from "../diff-utils";
import type { BuildCompareResult } from "./DiffView";

interface ItemData {
  slot?: string;
  name?: string;
  typeLine?: string;
  rarity?: string;
  itemLevel?: string | number;
  mods?: string[];
}

type Rarity = "normal" | "magic" | "rare" | "unique";

function rarityClass(rarity: string | undefined): Rarity {
  const r = (rarity ?? "").toLowerCase();
  if (r === "unique") return "unique";
  if (r === "rare") return "rare";
  if (r === "magic") return "magic";
  return "normal";
}

function asItem(v: unknown): ItemData | null {
  if (!v) return null;
  if (typeof v === "string") return { name: v };
  if (typeof v === "object") return v as ItemData;
  return null;
}

function ItemCard({
  item,
  tag,
  tagType,
}: {
  item: ItemData | null;
  tag?: string;
  tagType?: "add" | "rem" | "chg";
}) {
  if (!item) return <div className="eq-empty">—</div>;
  const rarity = rarityClass(item.rarity);
  const displayName = item.name || item.typeLine || "Item";
  const baseLine = item.name && item.typeLine ? item.typeLine : undefined;
  const mods = Array.isArray(item.mods) ? item.mods : [];

  return (
    <div className={`eq-card eq-${rarity}`}>
      <div className="eq-card-hdr">
        <span className="eq-card-name">{displayName}</span>
        {tag && <span className={`eq-tag eq-tag-${tagType ?? "chg"}`}>{tag}</span>}
      </div>
      {baseLine && <div className="eq-card-base">{baseLine}</div>}
      {mods.length > 0 && (
        <div className="eq-card-mods">
          {mods.slice(0, 4).map((mod, i) => (
            <div key={i} className="eq-mod">{mod}</div>
          ))}
          {mods.length > 4 && (
            <div className="eq-mod eq-mod-more">+{mods.length - 4} more…</div>
          )}
        </div>
      )}
      {item.itemLevel !== undefined && (
        <div className="eq-card-footer">iLvl {item.itemLevel}</div>
      )}
    </div>
  );
}

export function EquipmentTab({ diff }: { diff: BuildCompareResult | null }) {
  if (!diff) {
    return (
      <div className="tab-empty">Run a comparison to see equipment differences.</div>
    );
  }

  const rows = asArray(diff.items?.rows);

  if (rows.length === 0) {
    return (
      <div className="tab-empty">
        No equipment differences found — items are identical or comparison data is unavailable.
      </div>
    );
  }

  return (
    <div className="equipment-tab">
      <div className="eq-grid-head">
        <span className="eq-col-slot">Slot</span>
        <span className="eq-col-hd">Your Build</span>
        <span className="eq-col-hd eq-col-hd-tg">Target Build</span>
      </div>
      {rows.map((row, i) => {
        const slot = row.key ?? asItem(row.base)?.slot ?? asItem(row.target)?.slot ?? `Item ${i + 1}`;
        const base = asItem(row.base);
        const target = asItem(row.target);
        const status = row.status;

        return (
          <div key={slot} className="eq-row">
            <div className="eq-slot-label">{slot}</div>
            <div className="eq-cell">
              <ItemCard
                item={base}
                tag={status === "removed" ? "missing" : undefined}
                tagType="rem"
              />
            </div>
            <div className="eq-cell">
              <ItemCard
                item={target}
                tag={status === "added" ? "new" : status === "changed" ? "changed" : undefined}
                tagType={status === "added" ? "add" : "chg"}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
