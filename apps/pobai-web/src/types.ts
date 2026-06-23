export interface BuildInfo {
  snapshot_id: string;
  label: string;
  source: string;
  created_at: string;
  character?: {
    name?: string;
    className?: string;
    ascendancy?: string;
    level?: string | number;
  };
}

export interface ApiStatus {
  ok: boolean;
  buildsLoaded?: number;
  pob2Bridge?: {
    connected: boolean;
    url?: string;
    version?: string | null;
  };
  poe2Mcp?: {
    connected: boolean;
    toolCount?: number;
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result: unknown;
  error?: string;
}
