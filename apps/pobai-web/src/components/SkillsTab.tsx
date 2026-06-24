import React from "react";
import { asArray } from "../diff-utils";
import type { BuildCompareResult } from "./DiffView";

interface Gem {
  name?: string;
  level?: string | number;
  quality?: string | number;
  support?: unknown;
  enabled?: unknown;
}

interface SkillGroup {
  label?: string;
  name?: string;
  gems?: Array<string | Gem>;
}

type GemColor = "str" | "dex" | "int" | "wht";

const DEX_PATTERNS = /arrow|bow|projectile|evasion|dodge|dash|sprint|agility|mirage|flicker|blade|deadeye|ranger/i;
const INT_PATTERNS = /fire|cold|ice|lightning|shock|spark|spell|arc|meteor|arcane|mana|chaos|void|necrotic|summon|minion|bone|corpse|spirit|warp|temporal|comet|sorcerer/i;
const STR_PATTERNS = /slam|smash|strike|war|melee|shield|armour|armor|endurance|fortify|life|herald|bone|ground|earthquake|avalanche|warlord/i;

function gemColor(name: string | undefined): GemColor {
  if (!name) return "str";
  if (DEX_PATTERNS.test(name)) return "dex";
  if (INT_PATTERNS.test(name)) return "int";
  if (STR_PATTERNS.test(name)) return "str";
  return "str";
}

function isSupport(gem: string | Gem): boolean {
  if (typeof gem === "string") return /support|link/i.test(gem);
  return Boolean(gem.support) || /support|link/i.test(gem.name ?? "");
}

function gemName(gem: string | Gem): string {
  return typeof gem === "string" ? gem : (gem.name ?? "Gem");
}

function gemMeta(gem: string | Gem): string {
  if (typeof gem === "string") return "";
  const parts: string[] = [];
  if (gem.level != null && gem.level !== "") parts.push(`L${gem.level}`);
  if (gem.quality != null && gem.quality !== "" && String(gem.quality) !== "0") parts.push(`Q${gem.quality}`);
  return parts.join("/");
}

function skillLabel(group: SkillGroup): string {
  return group.label ?? group.name ?? "Skill group";
}

function skillGems(group: SkillGroup | null | undefined): Gem[] {
  if (!group) return [];
  return asArray(group.gems).map((g) => (typeof g === "string" ? { name: g } : g));
}

function GemSocket({ gem, status }: { gem: string | Gem; status?: "added" | "removed" | "changed" | "base" }) {
  const name = gemName(gem);
  const meta = gemMeta(gem);
  const color = gemColor(name);
  const support = isSupport(gem);
  const cls = ["gem-socket", `gem-socket-${color}`, support ? "gem-socket-sup" : "gem-socket-active", status ? `gem-socket-${status}` : ""].filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <div className="gem-dot" />
      <span className="gem-socket-name">{name}</span>
      {meta && <span className="gem-socket-meta">{meta}</span>}
    </div>
  );
}

function SkillGroupCard({
  group,
  status,
  addedGems,
  removedGems,
}: {
  group: SkillGroup | null | undefined;
  status?: "added" | "removed" | "unchanged" | "changed";
  addedGems?: Set<string>;
  removedGems?: Set<string>;
}) {
  const gems = skillGems(group);
  const label = skillLabel(group ?? {});
  const cardCls = ["skill-group-card", status ? `skill-group-${status}` : ""].filter(Boolean).join(" ");

  return (
    <div className={cardCls}>
      <div className="skill-group-label">{label}</div>
      <div className="gem-link-row">
        {gems.map((gem, i) => {
          const name = gemName(gem);
          const gemStatus = addedGems?.has(name) ? "added" : removedGems?.has(name) ? "removed" : undefined;
          return (
            <React.Fragment key={i}>
              {i > 0 && <div className="gem-link-bar" />}
              <GemSocket gem={gem} status={gemStatus} />
            </React.Fragment>
          );
        })}
        {gems.length === 0 && <span className="gem-empty">—</span>}
      </div>
    </div>
  );
}

export function SkillsTab({ diff }: { diff: BuildCompareResult | null }) {
  if (!diff) {
    return <div className="tab-empty">Run a comparison to see skill differences.</div>;
  }

  const rows = asArray(diff.skills?.rows);

  if (rows.length === 0) {
    const added = asArray(diff.skillsAdded);
    const removed = asArray(diff.skillsRemoved);
    const changed = asArray(diff.skillsChanged);
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      return (
        <div className="tab-empty">
          No skill differences found — skill setups are identical or comparison data is unavailable.
        </div>
      );
    }
  }

  // Build from rows (preferred) or legacy fields
  interface RowEntry {
    label: string;
    base: SkillGroup | null;
    target: SkillGroup | null;
    status: string;
    addedGems: Set<string>;
    removedGems: Set<string>;
  }

  const entries: RowEntry[] = rows.map((row) => {
    const base = (row.base ?? null) as SkillGroup | null;
    const target = (row.target ?? null) as SkillGroup | null;
    const label = skillLabel(target ?? base ?? { label: row.key ?? "Skill" });
    const baseNames = new Set(skillGems(base).map((g) => gemName(g)));
    const targetNames = new Set(skillGems(target).map((g) => gemName(g)));
    const addedGems = new Set([...targetNames].filter((n) => !baseNames.has(n)));
    const removedGems = new Set([...baseNames].filter((n) => !targetNames.has(n)));
    return { label, base, target, status: row.status ?? "unchanged", addedGems, removedGems };
  });

  return (
    <div className="skills-tab">
      <div className="skills-grid-head">
        <span className="skills-col-slot">Skill group</span>
        <span className="skills-col-hd">Your Build</span>
        <span className="skills-col-hd skills-col-hd-tg">Target Build</span>
      </div>
      {entries.map((entry, i) => (
        <div key={entry.label + i} className="skills-row">
          <div className="skills-slot-label">{entry.label}</div>
          <div className="skills-cell">
            <SkillGroupCard group={entry.base} status={entry.status === "removed" ? "removed" : undefined} removedGems={entry.removedGems} addedGems={new Set()} />
          </div>
          <div className="skills-cell">
            <SkillGroupCard group={entry.target} status={entry.status === "added" ? "added" : entry.status === "changed" ? "changed" : undefined} addedGems={entry.addedGems} removedGems={new Set()} />
          </div>
        </div>
      ))}
    </div>
  );
}
