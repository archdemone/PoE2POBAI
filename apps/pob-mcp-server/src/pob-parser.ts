import {
  decodePobCode as _decodePobCode,
  isPobCode as _isPobCode,
  parseBuildXml as _parseBuildXml,
  parseBuild as _parseBuild,
} from "@pobai/parser";

export const decodePobCode = _decodePobCode;
export const isPobCode = _isPobCode;
export const parseBuildXml = _parseBuildXml;
export const parseBuild = _parseBuild;

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
