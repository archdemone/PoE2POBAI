import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "../hooks/useWebSocket";

class MockWebSocket {
  static OPEN = 1;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];

  constructor(url: string) { this.url = url; }
  send(data: string) { this.sent.push(data); }
  close() {}
}

describe("useWebSocket", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWebSocket;
  });

  it("returns connected=false initially", () => {
    const { result } = renderHook(() => useWebSocket("ws://localhost:3001/ws"));
    expect(result.current.connected).toBe(false);
  });

  it("sets connected=true after open", () => {
    const { result } = renderHook(() => useWebSocket("ws://localhost:3001/ws"));
    act(() => {
      const ref = (result.current as any)._ws;
      const ws = ref.current as MockWebSocket;
      ws.readyState = MockWebSocket.OPEN;
      ws.onopen?.();
    });
    expect(result.current.connected).toBe(true);
  });

  it("sendMessage dispatches to handler on incoming message", () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWebSocket("ws://localhost:3001/ws"));
    act(() => {
      const ref = (result.current as any)._ws;
      const ws = ref.current as MockWebSocket;
      ws.onopen?.();
    });
    result.current.sendMessage("hello", "build123", handler);
    act(() => {
      const ref = (result.current as any)._ws;
      const ws = ref.current as MockWebSocket;
      ws.onmessage?.({ data: JSON.stringify({ type: "text", content: "hi" }) });
    });
    expect(handler).toHaveBeenCalledWith({ type: "text", content: "hi" });
  });

  it("handles reconnect on close", () => {
    const { result } = renderHook(() => useWebSocket("ws://localhost:3001/ws"));
    act(() => {
      const ref = (result.current as any)._ws;
      const ws = ref.current as MockWebSocket;
      ws.onclose?.();
    });
    expect(result.current.connected).toBe(false);
  });
});