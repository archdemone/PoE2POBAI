export interface StatChange {
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

export type Tone = "positive" | "negative" | "neutral";

export interface NormalizedStat {
  label: string;
  from: string;
  to: string;
  delta: string;
  tone: Tone;
  near: boolean;
}

export function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function displayValue(value: unknown): string {
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

export function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isNear(change: StatChange): boolean {
  return change.near === true || change.status === "near";
}

export function statTone(change: StatChange): Tone {
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

export function formatSignedNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export function formatDelta(change: StatChange): string {
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
