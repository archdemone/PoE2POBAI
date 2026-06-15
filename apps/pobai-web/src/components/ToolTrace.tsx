import React from "react";

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result: unknown;
  error?: string;
}

export function ToolTrace({ tool }: { tool: ToolCallState }) {
  const statusLabel = tool.status === "running" ? "Running..." : tool.status === "error" ? "Error" : "Complete";
  return (
    <div className={`tool-trace-item status-${tool.status}`}>
      <span className="tool-trace-name">{tool.name}</span>
      {Object.keys(tool.args).length > 0 && (<span className="tool-trace-args">({JSON.stringify(tool.args)})</span>)}
      <span className="tool-trace-status">{statusLabel}</span>
      {tool.error && <span className="tool-trace-error">{tool.error}</span>}
    </div>
  );
}