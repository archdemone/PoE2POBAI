import React, {
  useMemo, useRef, useEffect, useState, useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import type { BuildSnapshot, ChatMessage } from "@pobai/protocol";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_POBAI_API_URL ?? "http://localhost:3001";

// ── Types ────────────────────────────────────────────────────────────────────

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ChatMessageWithTrace extends ChatMessage {
  toolTrace?: ToolCall[];
}

interface SnapshotWithSummary extends BuildSnapshot {
  summary?: {
    character?: { className?: string; ascendancy?: string; level?: string };
    skills?: { label?: string }[];
    warnings?: string[];
  };
}

interface ServerStatus {
  ok: boolean;
  buildsLoaded: number;
  poe2Mcp: { connected: boolean; toolCount: number; tools: string[] };
  localTools: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectSource(text: string): string {
  const t = text.trim();
  if (t.startsWith("<") && /PathOfBuilding/i.test(t)) return "pob-xml";
  if (/^https?:\/\//i.test(t)) return "poe-ninja";
  return "pob-code";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ToolTrace({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="tool-trace">
      <summary>
        {calls.length} tool call{calls.length !== 1 ? "s" : ""}
      </summary>
      {calls.map((call, i) => (
        <div key={i} className="tool-call">
          <strong>{call.tool}</strong>
          {Object.keys(call.args).length > 0 && (
            <span className="tool-args">({JSON.stringify(call.args)})</span>
          )}
        </div>
      ))}
    </details>
  );
}

function BuildChip({ snapshot, selected, onClick }: {
  snapshot: SnapshotWithSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const char = snapshot.summary?.character;
  const meta = [char?.className, char?.ascendancy, char?.level ? `lvl ${char.level}` : ""]
    .filter(Boolean).join(" · ") || snapshot.source;
  return (
    <button
      className={`build-row${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      <span className="build-name">{snapshot.label}</span>
      <span className="build-meta">{meta}</span>
    </button>
  );
}

function ConnectionBadge({ status }: { status: ServerStatus | null }) {
  if (!status) return <span className="badge badge-off">connecting…</span>;
  if (status.poe2Mcp.connected) {
    return (
      <span className="badge badge-on" title={`${status.poe2Mcp.toolCount} poe2-mcp tools active`}>
        poe2-mcp ✓ {status.poe2Mcp.toolCount} tools
      </span>
    );
  }
  return (
    <span className="badge badge-warn" title="pip install poe2-mcp to enable live game data tools">
      poe2-mcp offline — local parse only
    </span>
  );
}

/** Full-screen launch modal — shown on every new session. */
function ImportModal({
  onImport,
  onSkip,
  hasExistingBuilds,
}: {
  onImport: (snapshot: SnapshotWithSummary, apiKey: string, model: string) => void;
  onSkip: () => void;
  hasExistingBuilds: boolean;
}) {
  const [paste, setPaste] = useState("");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-5");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && hasExistingBuilds) onSkip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasExistingBuilds, onSkip]);

  async function handleImport() {
    if (!paste.trim()) return;
    setImporting(true);
    setError("");
    try {
      const source = detectSource(paste);
      const res = await fetch(`${apiBaseUrl}/api/build/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          label: label.trim() || undefined,
          payload: paste.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text);
        return;
      }
      const data = await res.json() as { snapshot: SnapshotWithSummary };
      onImport(data.snapshot, apiKey, model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleImport();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <p className="eyebrow" style={{ marginBottom: "0.25rem" }}>
          Path of Building 2 · AI build advisor
        </p>
        <h1 className="modal-title">PoBAI</h1>
        <p className="modal-desc">
          Paste your build to get started. Accepts PoB2 export code, raw XML,
          or a poe.ninja URL.
        </p>

        <textarea
          ref={textareaRef}
          className="modal-paste"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={"Paste PoB2 export code, XML, or poe.ninja URL here…\n\nCtrl+Enter to load"}
          rows={5}
        />

        <div className="modal-row">
          <label className="modal-label-inline">
            Build name
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Twister Deadeye (optional)"
            />
          </label>
        </div>

        <details className="modal-advanced">
          <summary>AI settings (optional)</summary>
          <div className="modal-row" style={{ marginTop: "0.75rem" }}>
            <label className="modal-label-inline">
              OpenRouter API key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-… (leave blank for demo mode)"
              />
            </label>
            <label className="modal-label-inline" style={{ marginTop: "0.75rem" }}>
              Model
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek/deepseek-chat-v3-5"
              />
            </label>
          </div>
        </details>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button
            className="btn-primary"
            onClick={handleImport}
            disabled={!paste.trim() || importing}
          >
            {importing ? "Loading build…" : "Load Build & Start"}
          </button>
          {hasExistingBuilds && (
            <button className="btn-ghost" onClick={onSkip}>
              Skip — use existing builds
            </button>
          )}
        </div>

        <p className="modal-hint">
          No API key? Demo mode runs locally — real AI analysis needs an{" "}
          <a href="https://openrouter.ai" target="_blank" rel="noopener">
            OpenRouter
          </a>{" "}
          key.
        </p>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-5");
  const [snapshots, setSnapshots] = useState<SnapshotWithSummary[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotWithSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessageWithTrace[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);

  // Inline import panel state
  const [inlinePaste, setInlinePaste] = useState("");
  const [inlineLabel, setInlineLabel] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const canSend = useMemo(
    () => Boolean(model.trim() && draft.trim() && !loading),
    [model, draft, loading]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/build/current`);
      if (!res.ok) return;
      const data = await res.json() as { snapshots: SnapshotWithSummary[] };
      setSnapshots(data.snapshots ?? []);
    } catch {}
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/status`);
      if (res.ok) setServerStatus(await res.json() as ServerStatus);
    } catch {}
  }, []);

  useEffect(() => {
    fetchSnapshots();
    fetchStatus();
    const buildPoll = setInterval(fetchSnapshots, 5000);
    const statusPoll = setInterval(fetchStatus, 15000);
    return () => { clearInterval(buildPoll); clearInterval(statusPoll); };
  }, [fetchSnapshots, fetchStatus]);

  // Auto-select newest build when list updates
  useEffect(() => {
    if (!snapshot && snapshots.length > 0) setSnapshot(snapshots[0]!);
  }, [snapshots, snapshot]);

  async function triggerWelcomeMessage(
    snap: SnapshotWithSummary,
    key: string,
    mdl: string,
  ) {
    setLoading(true);
    setStatus("Analyzing your build…");
    try {
      const res = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key.trim(),
          model: mdl.trim(),
          snapshotId: snap.id,
          messages: [
            {
              role: "user",
              content:
                "Build loaded. Please give me a brief structured summary: character name, class, ascendancy, level, main skill(s), passive nodes allocated, and which analysis tools you have available. Keep it concise.",
            },
          ],
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as { message: ChatMessageWithTrace };
      setMessages([data.message]);
      setStatus("Ready");
    } catch {
      setStatus("Ready");
    } finally {
      setLoading(false);
    }
  }

  async function handleModalImport(
    snap: SnapshotWithSummary,
    key: string,
    mdl: string,
  ) {
    setApiKey(key);
    setModel(mdl);
    setSnapshot(snap);
    setMessages([]);
    setShowModal(false);
    await fetchSnapshots();
    await triggerWelcomeMessage(snap, key, mdl);
  }

  async function importBuildInline() {
    if (!inlinePaste.trim()) return;
    setStatus("Importing…");
    try {
      const source = detectSource(inlinePaste);
      const res = await fetch(`${apiBaseUrl}/api/build/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          label: inlineLabel.trim() || undefined,
          payload: inlinePaste.trim(),
        }),
      });
      if (!res.ok) { setStatus(`Import failed: ${await res.text()}`); return; }
      const data = await res.json() as { snapshot: SnapshotWithSummary };
      setSnapshot(data.snapshot);
      setInlinePaste("");
      setInlineLabel("");
      setStatus("Build imported.");
      setShowImportPanel(false);
      await fetchSnapshots();
      await triggerWelcomeMessage(data.snapshot, apiKey, model);
    } catch (e) {
      setStatus(`Import error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function sendMessage() {
    if (!canSend) return;
    const userMsg: ChatMessageWithTrace = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);
    setStatus(apiKey.trim() ? "Thinking…" : "Demo mode — running tools locally…");

    try {
      const res = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          model: model.trim(),
          snapshotId: snapshot?.id,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok) { setStatus(`Chat failed: ${await res.text()}`); return; }
      const data = await res.json() as { message: ChatMessageWithTrace };
      setMessages([...nextMessages, data.message]);
      setStatus("Ready");
    } catch (e) {
      setStatus(`Chat error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendMessage();
  }

  return (
    <>
      {showModal && (
        <ImportModal
          onImport={handleModalImport}
          onSkip={() => setShowModal(false)}
          hasExistingBuilds={snapshots.length > 0}
        />
      )}

      <main className="app-shell">
        {/* Header */}
        <header className="app-header">
          <div>
            <p className="eyebrow">Path of Building 2 · AI build advisor</p>
            <h1>PoBAI</h1>
          </div>
          <div className="header-right">
            <ConnectionBadge status={serverStatus} />
            <div className="status-pill">
              <span className="status-label">Status</span>
              <strong className="status-value">{status}</strong>
            </div>
          </div>
        </header>

        {/* Build sidebar + chat */}
        <div className="workspace">
          {/* Left: builds + settings */}
          <aside className="sidebar">
            {snapshot && (
              <div className="active-build">
                <div className="active-build-label">Active build</div>
                <strong className="active-build-name">{snapshot.label}</strong>
                <span className="active-build-meta">
                  {[
                    snapshot.summary?.character?.className,
                    snapshot.summary?.character?.ascendancy,
                    snapshot.summary?.character?.level
                      ? `lvl ${snapshot.summary.character.level}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || snapshot.source}
                </span>
                {(snapshot.summary?.warnings?.length ?? 0) > 0 && (
                  <details className="parse-warnings">
                    <summary>{snapshot.summary!.warnings!.length} parse note(s)</summary>
                    {snapshot.summary!.warnings!.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </details>
                )}
              </div>
            )}

            {snapshots.length > 0 && (
              <div className="build-list">
                <div className="build-list-header">
                  <span>All builds ({snapshots.length})</span>
                  <button className="btn-icon" onClick={fetchSnapshots} title="Refresh">↻</button>
                </div>
                {snapshots.map((s) => (
                  <BuildChip
                    key={s.id}
                    snapshot={s}
                    selected={s.id === snapshot?.id}
                    onClick={() => {
                      setSnapshot(s);
                      setMessages([]);
                      triggerWelcomeMessage(s, apiKey, model);
                    }}
                  />
                ))}
              </div>
            )}

            <button
              className="btn-ghost btn-full"
              onClick={() => setShowImportPanel((v) => !v)}
            >
              {showImportPanel ? "Cancel import" : "+ Import another build"}
            </button>

            {showImportPanel && (
              <div className="inline-import">
                <textarea
                  value={inlinePaste}
                  onChange={(e) => setInlinePaste(e.target.value)}
                  placeholder="Paste PoB code, XML, or poe.ninja URL…"
                  rows={4}
                />
                <input
                  value={inlineLabel}
                  onChange={(e) => setInlineLabel(e.target.value)}
                  placeholder="Build name (optional)"
                />
                <button onClick={importBuildInline} disabled={!inlinePaste.trim()}>
                  Import
                </button>
              </div>
            )}

            <details className="settings-panel">
              <summary>AI settings</summary>
              <div style={{ marginTop: "0.75rem" }}>
                <label>
                  OpenRouter API key <span className="muted">(optional)</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-or-…"
                  />
                </label>
                <label style={{ marginTop: "0.75rem" }}>
                  Model
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="deepseek/deepseek-chat-v3-5"
                  />
                </label>
                {!apiKey.trim() && (
                  <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                    Demo mode — responses use local build data only.
                  </p>
                )}
              </div>
            </details>
          </aside>

          {/* Right: chat */}
          <section className="chat-area">
            <div className="chat-log">
              {messages.length === 0 && !loading && (
                <div className="chat-empty">
                  {snapshot
                    ? <>
                        <p>Build loaded. Ask anything about <strong>{snapshot.label}</strong>.</p>
                        <p className="muted examples">
                          Try: "What is my Twister damage split?" ·
                          "Why are my resistances low?" ·
                          "How do I balance Trinity resonance?"
                        </p>
                      </>
                    : <p className="muted">Import a build to get started.</p>
                  }
                </div>
              )}
              {messages.map((msg) => (
                <article key={msg.id} className={`message ${msg.role}`}>
                  <strong className="msg-role">{msg.role === "assistant" ? "PoBAI" : "You"}</strong>
                  <p>{msg.content}</p>
                  {msg.toolTrace && msg.toolTrace.length > 0 && (
                    <ToolTrace calls={msg.toolTrace} />
                  )}
                </article>
              ))}
              {loading && (
                <article className="message assistant loading">
                  <strong className="msg-role">PoBAI</strong>
                  <p className="muted">Analyzing your build…</p>
                </article>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="composer">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  snapshot
                    ? "Ask about your build… (Ctrl+Enter to send)"
                    : "Import a build first, then ask questions here."
                }
                disabled={loading || !snapshot}
              />
              <button onClick={sendMessage} disabled={!canSend}>
                Send
              </button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
