import React, { useMemo } from "react";
import type { BuildCompareResult } from "./DiffView";

/**
 * The "hero" of the compare view: a scoreboard plus a full PoE2 character sheet
 * rendered as diverging tug-of-war bars. Bar colour is the verdict from MY
 * build's point of view — green = I have more, red = the target has more, white
 * = tied. Resistances are tinted by element and flagged when uncapped.
 */

type StatRow = {
  key?: string;
  label?: string;
  baseValue?: unknown;
  targetValue?: unknown;
  baseRaw?: unknown;
  targetRaw?: unknown;
};

type StatDef = {
  k: string;
  label: string;
  unit?: string;
  element?: "fire" | "cold" | "light" | "chaos";
  attr?: "str" | "dex" | "int";
  icon?: IconName;
  res?: boolean;
  dps?: boolean;
};

type Group = { title: string; icon: IconName; iconColor?: string; note?: string; wide?: boolean; stats: StatDef[] };

const GROUPS: Group[] = [
  {
    title: "Attributes", icon: "stats",
    stats: [
      { k: "str", label: "Strength", attr: "str" },
      { k: "dex", label: "Dexterity", attr: "dex" },
      { k: "int", label: "Intelligence", attr: "int" },
    ],
  },
  {
    title: "Life & resources", icon: "heart", iconColor: "var(--cmp-bad)",
    stats: [
      { k: "life", label: "Life" },
      { k: "energyshield", label: "Energy Shield" },
      { k: "manaunreserved", label: "Mana" },
      { k: "spirit", label: "Spirit" },
      { k: "totalehp", label: "Total eHP" },
    ],
  },
  {
    title: "Resistances", icon: "prism", note: "cap 75%",
    stats: [
      { k: "fireresist", label: "Fire", unit: "%", element: "fire", icon: "flame", res: true },
      { k: "coldresist", label: "Cold", unit: "%", element: "cold", icon: "snow", res: true },
      { k: "lightningresist", label: "Lightning", unit: "%", element: "light", icon: "bolt", res: true },
      { k: "chaosresist", label: "Chaos", unit: "%", element: "chaos", icon: "chaos", res: true },
    ],
  },
  {
    title: "Defences", icon: "shield",
    stats: [
      { k: "armour", label: "Armour" },
      { k: "evasion", label: "Evasion" },
      { k: "physicaldamagereduction", label: "Phys Reduction", unit: "%" },
      { k: "effectiveblockchance", label: "Block", unit: "%" },
      { k: "effectivespellblockchance", label: "Spell Block", unit: "%" },
      { k: "effectivespellsuppressionchance", label: "Spell Suppress", unit: "%" },
    ],
  },
  {
    title: "Offence", icon: "sword", wide: true,
    stats: [
      { k: "__dps", label: "Total DPS", icon: "sword", dps: true },
      { k: "averagehit", label: "Average Hit" },
      { k: "speed", label: "Attack / Cast Speed" },
      { k: "critmultiplier", label: "Crit Multiplier" },
    ],
  },
];

const DPS_KEYS = ["fulldps", "combineddps", "totaldps"];

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.trim().replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null, unit = ""): string {
  if (n == null) return "–";
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (unit === "%") s = String(Math.round(a * 10) / 10);
  else if (a >= 1e6) s = (a / 1e6).toFixed(2) + "M";
  else if (a >= 10000) s = (a / 1000).toFixed(1) + "k";
  else if (a >= 1000) s = Math.round(a).toLocaleString();
  else s = String(Math.round(a * 10) / 10);
  return (neg ? "−" : "") + s + unit;
}

// Larger side fills its full half (50%); the smaller side is proportional.
function widths(base: number | null, target: number | null): [number, number] {
  const b = Math.max(base ?? 0, 0);
  const t = Math.max(target ?? 0, 0);
  const max = Math.max(b, t);
  if (max <= 0) return [0, 0];
  const w = (v: number) => (v <= 0 ? 0 : Math.max(4, Math.round((v / max) * 50)));
  return [w(b), w(t)];
}

export function StatSheet({ diff }: { diff: BuildCompareResult }) {
  const rowsByKey = useMemo(() => {
    const map = new Map<string, StatRow>();
    for (const r of diff.defenses?.stats ?? []) if (r?.key) map.set(r.key, r as StatRow);
    for (const r of diff.stats?.rows ?? []) if (r?.key) map.set(r.key, r as StatRow);
    return map;
  }, [diff]);

  const dpsKey = useMemo(() => DPS_KEYS.find((k) => rowsByKey.has(k)), [rowsByKey]);

  const skillRows = diff.skills?.rows ?? [];
  const skillsAdd = skillRows.filter((r) => r.status === "added").length;
  const skillsDrop = skillRows.filter((r) => r.status === "removed").length;
  const skillsTweak = skillRows.filter((r) => r.status === "changed").length;
  const nodesAdd = diff.passiveTree?.addedNodeIds?.length ?? 0;
  const nodesDrop = diff.passiveTree?.removedNodeIds?.length ?? 0;

  const baseName = (diff.base as any)?.label ?? "My build";
  const targetName = (diff.target as any)?.label ?? "Target build";

  function renderStat(s: StatDef) {
    const key = s.dps ? dpsKey : s.k;
    if (!key) return null;
    const row = rowsByKey.get(key);
    if (!row) return null;
    const base = toNum(row.baseValue ?? row.baseRaw);
    const target = toNum(row.targetValue ?? row.targetRaw);
    if (base == null && target == null) return null;
    if ((base ?? 0) === 0 && (target ?? 0) === 0) return null;

    const verdict = base == null || target == null || base === target ? "tie" : base > target ? "me" : "tg";
    const [wM, wT] = widths(base, target);
    const d = (target ?? 0) - (base ?? 0);
    const delta =
      verdict === "tie" ? "= tied" : d > 0 ? `+${fmt(Math.abs(d), s.unit)} ▶` : `◀ +${fmt(Math.abs(d), s.unit)}`;

    const mineRes = s.res ? ((base ?? 0) >= 75 ? "cmp-resok" : "cmp-resbad") : "";
    const tgtRes = s.res ? ((target ?? 0) >= 75 ? "cmp-resok" : "cmp-resbad") : "";
    const labelCls = s.element ? `cmp-el-${s.element}` : s.attr ? `cmp-at-${s.attr}` : "";

    return (
      <div className={`cmp-ds cmp-${verdict}`} key={s.k}>
        <div className="cmp-top">
          <span className={`cmp-lab ${labelCls}`}>
            {s.icon && <Icon n={s.icon} />}
            {s.label}
          </span>
          <span className="cmp-dd">{delta}</span>
        </div>
        <div className="cmp-row">
          <span className={`cmp-mv ${mineRes}`}>{fmt(base, s.unit)}</span>
          <div className="cmp-track">
            <div className="cmp-fillM" style={{ width: `${wM}%` }} />
            <div className="cmp-fillT" style={{ width: `${wT}%` }} />
          </div>
          <span className={`cmp-tv ${tgtRes}`}>{fmt(target, s.unit)}</span>
        </div>
      </div>
    );
  }

  const cards = GROUPS.map((g) => {
    const rendered = g.stats.map(renderStat).filter(Boolean);
    if (rendered.length === 0) return null;
    return (
      <div className={`cmp-card${g.wide ? " cmp-wide" : ""}`} key={g.title}>
        <h4 className="cmp-h">
          <Icon n={g.icon} color={g.iconColor} />
          {g.title}
          {g.note && <span className="cmp-n">{g.note}</span>}
        </h4>
        {g.wide ? <div className="cmp-twocol">{rendered}</div> : rendered}
      </div>
    );
  }).filter(Boolean);

  return (
    <div className="cmp-sheet">
      <IconSheet />

      <div className="cmp-legend">
        <span>{"◀"} {baseName} grows left · {targetName} grows right {"▶"}</span>
        <span><i className="cmp-sw cmp-swg" /> green = I have more</span>
        <span><i className="cmp-sw cmp-swr" /> red = target has more</span>
        <span><i className="cmp-sw cmp-swn" /> white = same</span>
      </div>

      <div className="cmp-tiles">
        <Tile tone="add" icon="plus" label="Skills to add" value={skillsAdd} />
        <Tile tone="rem" icon="minus" label="Skills to drop" value={skillsDrop} />
        <Tile tone="chg" icon="swap" label="Gem tweaks" value={skillsTweak} />
        <Tile tone="node" icon="node" label={`Passive nodes${nodesDrop ? ` (−${nodesDrop})` : ""}`} value={`+${nodesAdd}`} />
      </div>

      <div className="cmp-grid">{cards}</div>
    </div>
  );
}

function Tile({ tone, icon, label, value }: { tone: string; icon: IconName; label: string; value: React.ReactNode }) {
  return (
    <div className={`cmp-tile cmp-tile-${tone}`}>
      <div className="cmp-cap"><Icon n={icon} />{label}</div>
      <div className="cmp-big">{value}</div>
    </div>
  );
}

/* ---- icons (hand-made line set, theme via currentColor) ---- */
type IconName =
  | "stats" | "heart" | "prism" | "shield" | "sword" | "gem" | "crossed"
  | "flame" | "snow" | "bolt" | "chaos" | "plus" | "minus" | "swap" | "node";

function Icon({ n, color }: { n: IconName; color?: string }) {
  return (
    <svg className="cmp-ic" style={color ? { color } : undefined} aria-hidden="true">
      <use href={`#cmp-i-${n}`} />
    </svg>
  );
}

function IconSheet() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="cmp-i-stats" viewBox="0 0 24 24"><line x1="5" y1="20" x2="5" y2="11" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="19" y1="20" x2="19" y2="14" /></symbol>
      <symbol id="cmp-i-heart" viewBox="0 0 24 24"><path d="M20.8 5.1a5.4 5.4 0 0 0-7.7 0L12 6.2l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7L12 21l8.8-8.2a5.4 5.4 0 0 0 0-7.7z" /></symbol>
      <symbol id="cmp-i-prism" viewBox="0 0 24 24"><polygon points="12 3 21 19 3 19" /><line x1="12" y1="3" x2="12" y2="19" /></symbol>
      <symbol id="cmp-i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></symbol>
      <symbol id="cmp-i-sword" viewBox="0 0 24 24"><polyline points="14.5 17.5 4 7 4 4 7 4 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /></symbol>
      <symbol id="cmp-i-gem" viewBox="0 0 24 24"><polygon points="12 3 19 9 12 21 5 9" /><line x1="5" y1="9" x2="19" y2="9" /></symbol>
      <symbol id="cmp-i-crossed" viewBox="0 0 24 24"><polyline points="14.5 17.5 4 7 4 4 7 4 17.5 14.5" /><polyline points="9.5 17.5 20 7 20 4 17 4 6.5 14.5" /></symbol>
      <symbol id="cmp-i-flame" viewBox="0 0 24 24"><path d="M12 3c1 3-1 4-1 6 0 1.4 1.1 2.5 2.5 2.5 1.6 0 2.5-1.3 2.4-3 1.3 1.2 2.1 3 2.1 5a8 8 0 0 1-16 0c0-3.6 2.7-6.4 4-8 .2 1.6 1 2.6 2 3 .4-2.6-.5-4.5 2-5.5z" /></symbol>
      <symbol id="cmp-i-snow" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21" /><line x1="4.2" y1="7.5" x2="19.8" y2="16.5" /><line x1="19.8" y1="7.5" x2="4.2" y2="16.5" /></symbol>
      <symbol id="cmp-i-bolt" viewBox="0 0 24 24" className="cmp-fill"><polygon points="13 2 4 14 11 14 10 22 20 9 13 9" /></symbol>
      <symbol id="cmp-i-chaos" viewBox="0 0 24 24" className="cmp-fill"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></symbol>
      <symbol id="cmp-i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></symbol>
      <symbol id="cmp-i-minus" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /></symbol>
      <symbol id="cmp-i-swap" viewBox="0 0 24 24"><polyline points="17 2 21 6 17 10" /><path d="M3 12V9a3 3 0 0 1 3-3h15" /><polyline points="7 22 3 18 7 14" /><path d="M21 12v3a3 3 0 0 1-3 3H3" /></symbol>
      <symbol id="cmp-i-node" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /></symbol>
    </svg>
  );
}
