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
}

export interface ParsedPassiveTree {
  url?: string;
  treeVersion?: string;
  allocatedNodeCount?: number;
  allocatedNodeIds?: string[];
}

export interface BuildSummary {
  kind: "pob-xml" | "pob-code" | "url" | "opaque";
  character: ParsedCharacter;
  skills: ParsedSkillGroup[];
  items: ParsedItem[];
  passiveTree: ParsedPassiveTree;
  defenses: Record<string, string>;
  detectedTerms: string[];
  warnings: string[];
}

export function decodePobCode(code: string): string;
export function isPobCode(input: string): boolean;
export function parseBuildXml(xml: string): BuildSummary;
export function parseBuild(input: string): { xml: string; summary: BuildSummary };
