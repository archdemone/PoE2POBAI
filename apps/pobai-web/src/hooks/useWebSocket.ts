import { useRef, useEffect, useState, useCallback } from "react";

interface WsMessage {
  type: "tool_calls" | "text" | "error";
  content?: string;
  message?: string;
  calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef<MessageHandler | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => connect(), 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WsMessage;
        handlerRef.current?.(msg);
      } catch {}
    };
    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const sendMessage = useCallback(
    (message: string, buildId: string, onMessage: MessageHandler) => {
      handlerRef.current = onMessage;
      wsRef.current?.send(JSON.stringify({ type: "chat", message, buildId }));
      return () => { handlerRef.current = null; };
    },
    []
  );

  const sendToolResults = useCallback(
    (results: Array<{ tool: string; output: unknown }>) => {
      wsRef.current?.send(JSON.stringify({ type: "tool_result", results }));
    },
    []
  );

  return { connected, sendMessage, sendToolResults, _ws: wsRef };
}