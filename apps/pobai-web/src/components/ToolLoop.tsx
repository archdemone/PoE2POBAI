import React from "react";
import { ToolTrace } from "./ToolTrace";

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result: unknown;
  error?: string;
}

export function ToolLoop({ tools }: { tools: ToolCallState[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="tool-loop">
      {tools.map((tool) => (
        <div key={tool.id} className="tool-loop-item">
          <ToolTrace tool={tool} />
        </div>
      ))}
    </div>
  );
}