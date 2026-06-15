import React, { useState, useRef, useEffect } from "react";

interface ChatPanelProps {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  onSend: (text: string) => void;
  disabled: boolean;
  children?: React.ReactNode;
}

export function ChatPanel({ messages, onSend, disabled, children }: ChatPanelProps) {
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

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-${msg.role}`}>
            <div className="chat-content">{msg.content}</div>
          </div>
        ))}
        {children}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <input className="chat-input" placeholder="Ask about this build..." value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
          disabled={disabled} />
        <button className="chat-send-btn" onClick={handleSend} disabled={disabled || !input.trim()}>Send</button>
      </div>
    </div>
  );
}