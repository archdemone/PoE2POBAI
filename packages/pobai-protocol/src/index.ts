export type BuildImportSource = "pob-code" | "pob-xml" | "poe-ninja" | "ggg-profile";

export interface ParsedCharacter {
  name?: string;
  className?: string;
  ascendancy?: string;
  level?: string;
  league?: string;
}

export interface ParsedGem {
  name?: string;
  level?: string;
  quality?: string;
  enabled?: string;
  support?: string;
}

export interface ParsedSkillGroup {
  id?: string;
  label?: string;
  enabled?: string;
  mainActiveSkill?: string;
  gems: ParsedGem[];
}

export interface ParsedItem {
  id?: string;
  slot?: string;
  name?: string;
  typeLine?: string;
  rarity?: string;
  itemLevel?: string;
  quality?: string;
  sockets?: string;
  mods?: string[];
}

export interface ParsedPassiveTree {
  url?: string;
  treeVersion?: string;
  allocatedNodeCount?: number;
  allocatedNodeIds?: string[];
  masteryEffects?: Array<{ node: string; effect: string }>;
}

export interface BuildSummary {
  kind: "pob-xml" | "pob-code" | "url" | "opaque";
  character: ParsedCharacter;
  skills: ParsedSkillGroup[];
  items: ParsedItem[];
  passiveTree: ParsedPassiveTree;
  defenses: Record<string, string>;
  /** Full numeric stat sheet (attributes, life, resists, defences, offence). */
  stats?: Record<string, string | number>;
  detectedTerms: string[];
  warnings: string[];
  resolvedFrom?: string;
}

export interface BuildSnapshot {
  id: string;
  source: BuildImportSource;
  createdAt: string;
  label: string;
  hash: string;
  sizeBytes: number;
  preview: string;
  summary?: BuildSummary;
}

/** Canonical import payload. Either `payload` or the deprecated `code` is required. */
type ImportBuildPayload =
  | { payload: string; code?: never }
  | { payload?: never; /** @deprecated Use payload. */ code: string };

export type ImportBuildRequest = {
  source: BuildImportSource;
  label?: string;
} & ImportBuildPayload;

export interface ImportBuildResponse {
  snapshot: BuildSnapshot;
}

export interface CompareBuildRequest {
  baseId: string;
  targetId: string;
}

export type CompareStatus = "added" | "removed" | "changed" | "unchanged";
export type CompareDirection = "added" | "removed" | "increase" | "decrease" | "changed" | "unchanged";
export type CompareImpact = "better" | "worse" | "changed" | "neutral";
export type CompareColor = "green" | "red" | "neutral";

export interface CompareValue {
  key: string;
  label: string;
  category: string;
  type: "numeric" | "text";
  baseValue: string | number | null;
  targetValue: string | number | null;
  baseRaw?: string | number | null;
  targetRaw?: string | number | null;
  delta: number | null;
  percentDelta: number | null;
  direction: CompareDirection;
  changed: boolean;
  status: CompareStatus;
  higherIsBetter: boolean | null;
  impact: CompareImpact;
  color: CompareColor;
}

export interface CompareCounts {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface CollectionComparisonRow<T> {
  key: string;
  status: CompareStatus;
  changed: boolean;
  base: T | null;
  target: T | null;
}

export interface CollectionComparison<T> {
  rows: CollectionComparisonRow<T>[];
  counts: CompareCounts;
  changed: boolean;
}

export interface ComparedSnapshotMetadata {
  id: string;
  label: string;
  source: BuildImportSource;
  createdAt: string;
  hash: string;
  sizeBytes: number;
  character: ParsedCharacter;
}

export interface BuildCompareResponse {
  base: ComparedSnapshotMetadata;
  target: ComparedSnapshotMetadata;
  character: {
    fields: CompareValue[];
    counts: CompareCounts;
    changed: boolean;
  };
  skills: CollectionComparison<ParsedSkillGroup>;
  items: CollectionComparison<ParsedItem>;
  passiveTree: {
    base: ParsedPassiveTree;
    target: ParsedPassiveTree;
    allocatedNodeCount: CompareValue;
    treeVersion: CompareValue;
    url: CompareValue;
    addedNodeIds: string[];
    removedNodeIds: string[];
    sharedNodeCount: number;
    changed: boolean;
  };
  defenses: {
    stats: CompareValue[];
    counts: CompareCounts;
    changed: boolean;
  };
  statDiffs: CompareValue[];
}

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChatRequest {
  apiKey: string;
  model: string;
  messages: Pick<ChatMessage, "role" | "content">[];
  snapshotId?: string;
}

export interface ChatResponse {
  message: ChatMessage;
}

export interface HealthResponse {
  ok: boolean;
  service: "pobai-server";
  version: string;
}
