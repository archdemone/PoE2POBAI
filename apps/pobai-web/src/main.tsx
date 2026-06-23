import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "./components/ChatPanel";
import { ToolLoop } from "./components/ToolLoop";
import { BuildSidebar } from "./components/BuildSidebar";
import { BuildCompare } from "./components/BuildCompare";
import { ImportModal } from "./components/ImportModal";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ApiStatus, ChatMessage, ToolCallState, BuildInfo } from "./types";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_POBAI_API_URL ?? "http://localhost:3001";
const defaultModel = import.meta.env.VITE_POBAI_MODEL ?? "openai/gpt-4o-mini";

const API_KEY_STORAGE = "pobai.apiKey";
const MODEL_STORAGE = "pobai.model";

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

interface ChatResponse {
  message?: {
    content?: string;
    toolTrace?: ToolTraceEntry[];
  };
  content?: string;
  error?: string;
}

interface ToolTraceEntry {
  tool?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  output?: unknown;
  error?: unknown;
}

interface ImportSnapshotResponse {
  snapshot?: {
    id?: string;
    label?: string;
    source?: string;
    createdAt?: string;
    summary?: { character?: BuildInfo["character"] };
  };
  snapshot_id?: string;
}

interface Pob2ExportResponse {
  xml?: unknown;
  build_xml?: unknown;
  exportCode?: unknown;
  code?: unknown;
  buildName?: unknown;
  name?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolTrace(trace: ToolTraceEntry[] | undefined): ToolCallState[] {
  if (!trace) return [];
  return trace.map((entry, index) => {
    const name = entry.tool ?? entry.name ?? `tool_${index + 1}`;
    return {
      id: `${name}-${index}`,
      name,
      args: isRecord(entry.args) ? entry.args : {},
      status: entry.error ? "error" : "complete",
      result: entry.result ?? entry.output ?? null,
      error: typeof entry.error === "string" ? entry.error : undefined,
    };
  });
}

function isLikelyPlayerBuild(build: BuildInfo): boolean {
  return /\b(my|current)\b/i.test(build.label);
}

function selectInitialBuild(builds: BuildInfo[]): string | null {
  return builds.find(isLikelyPlayerBuild)?.snapshot_id ?? builds[0]?.snapshot_id ?? null;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === "string") return body.error;
    if (typeof body.detail === "string") return body.detail;
  } catch {}
  return `Request failed with ${res.status}`;
}

export function App() {
  const [builds, setBuilds] = useState<BuildInfo[]>([]);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolCallState[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [importingCurrent, setImportingCurrent] = useState(false);
  const [chatPending, setChatPending] = useState(false);
  const [apiKey, setApiKey] = useState(() => readStorage(API_KEY_STORAGE, ""));
  const [model, setModel] = useState(() => readStorage(MODEL_STORAGE, defaultModel));

  function handleSaveSettings(nextKey: string, nextModel: string) {
    setApiKey(nextKey);
    setModel(nextModel);
    try {
      if (nextKey) localStorage.setItem(API_KEY_STORAGE, nextKey);
      else localStorage.removeItem(API_KEY_STORAGE);
      localStorage.setItem(MODEL_STORAGE, nextModel);
    } catch {}
  }

  useEffect(() => {
    loadBuilds();
    loadStatus();
    const timer = window.setInterval(loadStatus, 8000);
    return () => window.clearInterval(timer);
  }, []);

  async function loadBuilds() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/builds`);
      const data = await res.json();
      const nextBuilds = Array.isArray(data) ? data : [];
      setBuilds(nextBuilds);
      setActiveBuildId((current) => {
        if (current && nextBuilds.some((build) => build.snapshot_id === current)) return current;
        return selectInitialBuild(nextBuilds);
      });
    } catch {}
  }

  async function loadStatus() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/status`);
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setApiStatus((await res.json()) as ApiStatus);
    } catch {
      setApiStatus(null);
    }
  }

  async function importBuild(payload: string, label: string, source: string): Promise<string | null> {
    const res = await fetch(`${apiBaseUrl}/api/build/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, label, payload }),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = (await res.json()) as ImportSnapshotResponse;
    return data.snapshot?.id ?? data.snapshot_id ?? null;
  }

  async function handleImport(payload: string, label: string, source: string) {
    const snapshotId = await importBuild(payload, label, source);
    await loadBuilds();
    if (snapshotId) setActiveBuildId(snapshotId);
    await loadStatus();
  }

  async function handleImportCurrentPob() {
    setImportingCurrent(true);
    setStatus("Exporting current PoB build...");
    try {
      const exportRes = await fetch(`${apiBaseUrl}/api/pob2/export`, { method: "POST" });
      if (!exportRes.ok) throw new Error(await readErrorMessage(exportRes));
      const exported = (await exportRes.json()) as Pob2ExportResponse;
      if (typeof exported.error === "string") throw new Error(exported.error);

      const xml = typeof exported.xml === "string" ? exported.xml : typeof exported.build_xml === "string" ? exported.build_xml : "";
      const code = typeof exported.exportCode === "string" ? exported.exportCode : typeof exported.code === "string" ? exported.code : "";
      const payload = xml || code;
      if (!payload) throw new Error("PoB bridge exported no XML or export code.");

      const labelBase = typeof exported.buildName === "string"
        ? exported.buildName
        : typeof exported.name === "string"
          ? exported.name
          : "Current PoB build";
      const snapshotId = await importBuild(payload, labelBase, xml ? "pob-xml" : "pob-code");
      await loadBuilds();
      if (snapshotId) setActiveBuildId(snapshotId);
      setStatus(`Imported ${labelBase} from PoB.`);
      await loadStatus();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not import current PoB build.");
    } finally {
      setImportingCurrent(false);
    }
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

  const handleSend = useCallback(async (text: string) => {
    if (!activeBuildId) { setStatus("Import a build first"); return; }
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setTools([]);
    setChatPending(true);
    setStatus("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model,
          snapshotId: activeBuildId,
          messages: nextMessages,
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const body = (await res.json()) as ChatResponse;
      const content = body.message?.content ?? body.content ?? body.error ?? "";
      setTools(normalizeToolTrace(body.message?.toolTrace));
      setMessages((prev) => [...prev, { role: "assistant", content: content || "No response content." }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown chat error";
      setTools([]);
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${message}` }]);
    } finally {
      setChatPending(false);
    }
  }, [activeBuildId, messages, apiKey, model]);

  return (
    <ErrorBoundary>
      <div className="app">
        <BuildSidebar builds={builds} activeId={activeBuildId} onSelect={handleSelect} onDelete={handleDelete} onImport={() => setImportOpen(true)} />
        <div className="main-area">
          <div className="status-bar">
            <span>API: {apiBaseUrl}</span>
            <span className={apiStatus?.pob2Bridge?.connected ? "status-ok" : "status-warn"}>
              PoB bridge: {apiStatus?.pob2Bridge?.connected ? "connected" : "offline"}
            </span>
            <span className={apiKey ? "status-ok" : "status-warn"}>
              Chat: {apiKey ? `Live · ${model}` : "Demo mode"}
            </span>
            <button className="btn-secondary status-settings-btn" onClick={() => setSettingsOpen(true)}>Settings</button>
            {chatPending && <span>Sending...</span>}
            {status && <span>{status}</span>}
          </div>
          <div className="workspace-grid">
            <BuildCompare
              builds={builds}
              activeBuildId={activeBuildId}
              apiBaseUrl={apiBaseUrl}
              pob2Connected={apiStatus?.pob2Bridge?.connected ?? false}
              bridgeUrl={apiStatus?.pob2Bridge?.url}
              importingCurrent={importingCurrent}
              onImportCurrent={handleImportCurrentPob}
              onOpenImport={() => setImportOpen(true)}
            />
            <ChatPanel messages={messages} onSend={handleSend} disabled={!activeBuildId || chatPending}>
              <ToolLoop tools={tools} />
            </ChatPanel>
          </div>
        </div>
        <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} />
        <SettingsModal
          open={settingsOpen}
          apiKey={apiKey}
          model={model}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      </div>
    </ErrorBoundary>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
