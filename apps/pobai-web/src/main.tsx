import React, { useMemo, useRef, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BuildSnapshot, ChatMessage } from "@pobai/protocol";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_POBAI_API_URL ?? "http://localhost:3001";

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ChatMessageWithTrace extends ChatMessage {
  toolTrace?: ToolCall[];
}

function ToolTrace({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="tool-trace">
      <summary>{calls.length} tool call{calls.length !== 1 ? "s" : ""}</summary>
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

function App() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [source, setSource] = useState("pob-code");
  const [label, setLabel] = useState("");
  const [payload, setPayload] = useState("");
  const [snapshot, setSnapshot] = useState<BuildSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessageWithTrace[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => model.trim() && draft.trim() && !loading, [model, draft, loading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function importBuild() {
    if (!payload.trim()) return;
    setStatus("Importing…");
    try {
      const res = await fetch(`${apiBaseUrl}/api/build/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, label: label.trim() || undefined, payload: payload.trim() }),
      });
      if (!res.ok) { setStatus(`Import failed: ${await res.text()}`); return; }
      const data = await res.json() as { snapshot: BuildSnapshot };
      setSnapshot(data.snapshot);
      setStatus("Build imported — ready to chat.");
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
    setStatus(apiKey.trim() ? "Calling tools…" : "Demo mode — running tools locally…");

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
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Path of Building 2 · AI build advisor</p>
          <h1>PoBAI</h1>
          <p>
            Import a PoB2 build, then ask questions. The assistant calls build tools to get real data before answering —
            no invented numbers.{" "}
            {!apiKey.trim() && <span className="muted">Add an OpenRouter key to use a live model. Demo mode works without one.</span>}
          </p>
        </div>
        <div className="status-card">
          <span>Status</span>
          <strong>{status}</strong>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>1. Model</h2>
          <label>
            OpenRouter API key <span className="muted">(optional — demo mode works without)</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-…"
            />
          </label>
          <label>
            Model slug
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="openai/gpt-4o-mini"
            />
          </label>
        </div>

        <div className="panel">
          <h2>2. Build</h2>
          <div className="row">
            <label>
              Source
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="pob-code">PoB export code</option>
                <option value="pob-xml">PoB XML</option>
                <option value="poe-ninja">poe.ninja URL</option>
                <option value="ggg-profile">GGG profile</option>
              </select>
            </label>
            <label>
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Twister Deadeye"
              />
            </label>
          </div>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder="Paste PoB export code or XML here"
          />
          <button onClick={importBuild} disabled={!payload.trim()}>
            Import build
          </button>
          {snapshot ? (
            <div className="snapshot">
              <strong>{snapshot.label}</strong>
              <span>{snapshot.source} · {snapshot.sizeBytes.toLocaleString()} bytes · #{snapshot.hash.slice(0, 10)}</span>
            </div>
          ) : (
            <p className="muted">No build imported yet.</p>
          )}
        </div>
      </section>

      <section className="panel chat-panel">
        <h2>3. Chat</h2>
        <div className="chat-log">
          {messages.length === 0 && (
            <p className="muted">Import a build above, then ask a question — e.g. "Why are my defenses low?" or "What supports would improve Twister?"</p>
          )}
          {messages.map((msg) => (
            <article key={msg.id} className={`message ${msg.role}`}>
              <strong className="msg-role">{msg.role}</strong>
              <p>{msg.content}</p>
              {msg.toolTrace && msg.toolTrace.length > 0 && (
                <ToolTrace calls={msg.toolTrace} />
              )}
            </article>
          ))}
          {loading && (
            <article className="message assistant loading">
              <strong className="msg-role">assistant</strong>
              <p className="muted">Calling tools…</p>
            </article>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your build… (Ctrl+Enter to send)"
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={!canSend}>Send</button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
