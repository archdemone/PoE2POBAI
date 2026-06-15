export type BuildImportSource = "pob-code" | "pob-xml" | "poe-ninja" | "ggg-profile";

export interface BuildSnapshot {
  id: string;
  source: BuildImportSource;
  createdAt: string;
  label: string;
  hash: string;
  sizeBytes: number;
  preview: string;
}

export interface ImportBuildRequest {
  source: BuildImportSource;
  label?: string;
  payload: string;
}

export interface ImportBuildResponse {
  snapshot: BuildSnapshot;
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
