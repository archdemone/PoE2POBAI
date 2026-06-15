import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BuildSnapshot, ChatMessage } from "@pobai/protocol";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_POBAI_API_URL ?? "http://localhost:3001";

function App() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [source, setSource] = useState("pob-code");
  const [label, setLabel] = useState("");
  const [payload, setPayload] = useState("");
  const [snapshot, setSnapshot] = useState<BuildSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("What can you tell me about this build snapshot?");
  const [status, setStatus] = useState("Ready");

  const canChat = useMemo(() => apiKey.trim() && model.trim() && draft.trim(), [apiKey, model, draft]);

  async function importBuild() {
    setStatus("Importing snapshot...");
    const response = await fetch(`${apiBaseUrl}/api/build/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, label: label || undefined, payload }),
    });
    if (!response.ok) {
      setStatus(`Import failed: ${await response.text()}`);
      return;
    }
    const data = await response.json() as { snapshot: BuildSnapshot };
    setSnapshot(data.snapshot);
    setStatus("Snapshot imported. PoBAI will treat it as immutable until you import again.");
  }

  async function sendMessage() {
    if (!canChat) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setStatus("Asking OpenRouter...");

    const response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model,
        snapshotId: snapshot?.id,
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
      }),
    });

    if (!response.ok) {
      setStatus(`Chat failed: ${await response.text()}`);
      return;
    }

    const data = await response.json() as { message: ChatMessage };
    setMessages([...nextMessages, data.message]);
    setStatus("Ready");
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Path of Building 2 AI assistant</p>
          <h1>PoBAI proof of concept</h1>
          <p>
            Import a fresh PoB2 snapshot, connect an OpenRouter model, and chat with a build-mechanics assistant.
            MCP/PoB math tools are scaffolded as the next integration layer.
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
            OpenRouter API key
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-or-..." />
          </label>
          <label>
            Model slug
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4o-mini" />
          </label>
        </div>

        <div className="panel">
          <h2>2. Build snapshot</h2>
          <div className="row">
            <label>
              Source
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="pob-code">PoB code</option>
                <option value="pob-xml">PoB XML</option>
                <option value="poe-ninja">poe.ninja URL</option>
                <option value="ggg-profile">GGG profile</option>
              </select>
            </label>
            <label>
              Label
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Twister Deadeye import" />
            </label>
          </div>
          <textarea value={payload} onChange={(event) => setPayload(event.target.value)} placeholder="Paste PoB code/XML or URL here" />
          <button onClick={importBuild} disabled={!payload.trim()}>Import immutable snapshot</button>
          {snapshot ? (
            <div className="snapshot">
              <strong>{snapshot.label}</strong>
              <span>{snapshot.source} · {snapshot.sizeBytes} bytes · {snapshot.hash.slice(0, 12)}</span>
            </div>
          ) : <p className="muted">No snapshot imported yet.</p>}
        </div>
      </section>

      <section className="panel chat-panel">
        <h2>3. Chat</h2>
        <div className="chat-log">
          {messages.length === 0 ? <p className="muted">Ask a build-mechanics question after importing a snapshot.</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <strong>{message.role}</strong>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <div className="composer">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask PoBAI about your build..." />
          <button onClick={sendMessage} disabled={!canChat}>Send</button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
