import React, { useState, useRef, useEffect } from "react";

const QUICK_CHIPS = [
  "What should I change first?",
  "How is my DPS different?",
  "Which gems do I need?",
  "Explain the passive tree changes",
];

interface ChatPanelProps {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onSend: (text: string) => void;
  disabled: boolean;
  freeTier?: boolean;
  modelHint?: string;
  children?: React.ReactNode;
}

export function ChatPanel({ messages, onSend, disabled, freeTier, modelHint, children }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, children]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  const showChips = messages.length === 0 && !disabled;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">AI Assistant</span>
        {modelHint && (
          <span className={`chat-model-hint${freeTier ? " chat-model-hint-free" : ""}`}>
            {modelHint}{freeTier ? " · Free" : ""}
          </span>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">⚗</div>
            <p>Ask about your build comparison, stat differences, or what to change first.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
            <div className="chat-bubble-content">{msg.content}</div>
          </div>
        ))}
        {children}
        <div ref={bottomRef} />
      </div>

      {showChips && (
        <div className="chat-chips">
          {QUICK_CHIPS.map((chip) => (
            <button key={chip} className="chat-chip" onClick={() => onSend(chip)} disabled={disabled}>
              {chip}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-area">
        <input
          className="chat-input"
          placeholder="Ask about this build..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={disabled}
        />
        <button className="chat-send-btn" onClick={handleSend} disabled={disabled || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
