import React from "react";
import { asArray } from "../diff-utils";

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

interface GemDiff {
  added?: Gem[];
  removed?: Gem[];
  changed?: Array<{ name?: string; base?: Gem; target?: Gem }>;
}

interface CollectionRow {
  key?: string;
  status?: "added" | "removed" | "changed" | "unchanged";
  changed?: boolean;
  base?: SkillChange | null;
  target?: SkillChange | null;
  gemDiff?: GemDiff;
}

function normKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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

function skillLabel(skill: SkillChange): string {
  return skill.label ?? skill.name ?? "Unknown skill";
}

function skillGems(skill: SkillChange | null | undefined): Gem[] {
  if (!skill) return [];
  return asArray(skill.gems).map((gem) => (typeof gem === "string" ? { name: gem } : gem));
}

function skillFromRow(row: CollectionRow, side: "base" | "target"): SkillChange {
  return (side === "base" ? row.base : row.target) ?? { label: row.key ?? "Unknown skill" };
}

function computeGemDiff(base: Gem[], target: Gem[]): GemDiff {
  const baseByKey = new Map(base.map((g) => [normKey(g.name), g]));
  const targetByKey = new Map(target.map((g) => [normKey(g.name), g]));
  const added: Gem[] = [];
  const removed: Gem[] = [];
  const changed: NonNullable<GemDiff["changed"]> = [];
  for (const [key, gem] of targetByKey) if (!baseByKey.has(key)) added.push(gem);
  for (const [key, gem] of baseByKey) if (!targetByKey.has(key)) removed.push(gem);
  for (const [key, t] of targetByKey) {
    const b = baseByKey.get(key);
    if (!b) continue;
    if (String(b.level ?? "") !== String(t.level ?? "") || String(b.quality ?? "") !== String(t.quality ?? "")) {
      changed.push({ name: t.name, base: b, target: t });
    }
  }
  return { added, removed, changed };
}

function gemDiffEmpty(diff: GemDiff | undefined): boolean {
  if (!diff) return true;
  return asArray(diff.added).length === 0 && asArray(diff.removed).length === 0 && asArray(diff.changed).length === 0;
}

export function SkillChangeRow({ row }: { row: CollectionRow }) {
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
