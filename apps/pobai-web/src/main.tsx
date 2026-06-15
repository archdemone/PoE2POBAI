import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "./components/ChatPanel";
import { ToolLoop } from "./components/ToolLoop";
import { BuildSidebar } from "./components/BuildSidebar";
import { ImportModal } from "./components/ImportModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useWebSocket } from "./hooks/useWebSocket";
import type { BuildSnapshot } from "@pobai/protocol";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_POBAI_API_URL ?? "http://localhost:3001";
const wsUrl = apiBaseUrl.replace(/^http/, "ws") + "/ws";

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result: unknown;
  error?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface BuildInfo {
  snapshot_id: string;
  label: string;
  source: string;
  created_at: string;
  character?: { className?: string; ascendancy?: string; level?: string };
}

function App() {
  const [builds, setBuilds] = useState<BuildInfo[]>([]);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolCallState[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [status, setStatus] = useState("");

  const { connected, sendMessage, sendToolResults } = useWebSocket(wsUrl);

  useEffect(() => { loadBuilds(); }, []);

  async function loadBuilds() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/builds`);
      const data = await res.json();
      setBuilds(Array.isArray(data) ? data : []);
    } catch {}
  }

  async function handleImport(code: string, label: string, source: string) {
    const res = await fetch(`${apiBaseUrl}/api/build/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label, source }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Import failed"); }
    await loadBuilds();
  }

  async function handleSelect(id: string) {
    setActiveBuildId(id);
    setMessages([]);
    setTools([]);
  }

  async function handleDelete(id: string) {
    await fetch(`${apiBaseUrl}/api/build/${id}`, { method: "DELETE" });
    if (activeBuildId === id) { setActiveBuildId(null); setMessages([]); setTools([]); }
    await loadBuilds();
  }

  async function executeTool(tool: { name: string; args: Record<string, unknown> }) {
    const snapshotId = tool.args.snapshot_id || activeBuildId;
    const endpointMap: Record<string, string> = {
      get_build_summary: `/api/build/${snapshotId}/summary`,
      get_skills: `/api/build/${snapshotId}/skills`,
      get_items: `/api/build/${snapshotId}/items`,
      get_passive_tree: `/api/build/${snapshotId}/passive-tree`,
      get_defenses: `/api/build/${snapshotId}/defenses`,
      list_builds: "/api/builds",
    };
    const url = endpointMap[tool.name];
    if (!url) return { error: `Unknown tool: ${tool.name}` };
    const res = await fetch(`${apiBaseUrl}${url}`);
    if (!res.ok) return { error: `Tool ${tool.name} failed: ${res.status}` };
    return await res.json();
  }

  const handleSend = useCallback(async (text: string) => {
    if (!activeBuildId) { setStatus("Import a build first"); return; }
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setTools([]);
    setStatus("");

    sendMessage(text, activeBuildId, async (msg) => {
      if (msg.type === "tool_calls" && msg.calls) {
        const newTools: ToolCallState[] = msg.calls.map((c) => ({
          id: c.id, name: c.name, args: c.args, status: "running" as const, result: null,
        }));
        setTools(newTools);
        const results: Array<{ tool: string; output: unknown }> = [];
        for (const tool of newTools) {
          try {
            const output = await executeTool({ name: tool.name, args: tool.args });
            results.push({ tool: tool.name, output });
            setTools((prev) => prev.map((t) => t.id === tool.id ? { ...t, status: "complete" as const, result: output } : t));
          } catch (e: any) {
            setTools((prev) => prev.map((t) => t.id === tool.id ? { ...t, status: "error" as const, error: e.message } : t));
          }
        }
        sendToolResults(results);
      } else if (msg.type === "text" && msg.content) {
        const text = msg.content;
        setMessages((prev) => [...prev, { role: "assistant", content: text }]);
        setTools([]);
      } else if (msg.type === "error") {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg.message || "Unknown error"}` }]);
        setTools([]);
      }
    });
  }, [activeBuildId, sendMessage, sendToolResults]);

  return (
    <ErrorBoundary>
      <div className="app">
        <BuildSidebar builds={builds} activeId={activeBuildId} onSelect={handleSelect} onDelete={handleDelete} onImport={() => setImportOpen(true)} />
        <div className="main-area">
          <div className="status-bar">
            <span>WS: {connected ? "connected" : "disconnected"}</span>
            {status && <span>{status}</span>}
          </div>
          <ChatPanel messages={messages} onSend={handleSend} disabled={!connected}>
            <ToolLoop tools={tools} />
          </ChatPanel>
        </div>
        <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} />
      </div>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(<App />);