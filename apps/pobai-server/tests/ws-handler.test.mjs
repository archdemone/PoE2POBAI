import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import { createWsHandler } from "../src/ws-handler.mjs";

const testLocalTools = [
  { name: "get_build_summary", description: "Get build summary", inputSchema: { type: "object", properties: {} } },
  { name: "get_defenses", description: "Get defenses", inputSchema: { type: "object", properties: {} } },
];

describe("ws-handler", () => {
  it("accepts WebSocket connections and echoes chat messages as tool_calls in demo mode", async () => {
    const httpServer = createServer();
    const handler = createWsHandler({ openRouterApiKey: null, poe2McpTools: [], localTools: testLocalTools });
    httpServer.on("upgrade", (req, socket, head) => {
      handler(req, socket, head);
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;

    const messages = [];
    const ws = new WebSocket(`ws://localhost:${port}`);

    const done = new Promise((resolve) => {
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 2) resolve();
      });
    });

    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "chat", message: "hello", buildId: "test" }));

    await done;

    expect(messages.some((m) => m.type === "tool_calls")).toBe(true);
    expect(messages.some((m) => m.type === "text")).toBe(true);

    ws.close();
    httpServer.close();
  });

  it("handles tool_result messages", async () => {
    const httpServer = createServer();
    const handler = createWsHandler({ openRouterApiKey: null, poe2McpTools: [], localTools: testLocalTools });
    httpServer.on("upgrade", (req, socket, head) => handler(req, socket, head));

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;

    let sawSecondRound = false;
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "tool_calls" && !sawSecondRound) {
        sawSecondRound = true;
        ws.send(JSON.stringify({
          type: "tool_result",
          results: [{ tool: "get_defenses", output: { life: 4500 } }],
        }));
      }
    });

    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "chat", message: "check defenses", buildId: "test" }));

    await new Promise((resolve) => setTimeout(resolve, 1000));
    ws.close();
    httpServer.close();
  });

  it("errors on non-JSON messages", async () => {
    const httpServer = createServer();
    const handler = createWsHandler({ openRouterApiKey: null, poe2McpTools: [], localTools: testLocalTools });
    httpServer.on("upgrade", (req, socket, head) => handler(req, socket, head));

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on("open", resolve));
    ws.send("not json");

    const errorMsg = await new Promise((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "error") resolve(msg);
      });
    });

    expect(errorMsg.message).toContain("Invalid message");
    ws.close();
    httpServer.close();
  });
});