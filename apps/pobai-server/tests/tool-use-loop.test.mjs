/**
 * Tool-use loop integration test for /api/chat
 *
 * Starts a mock "OpenRouter" HTTP server that returns scripted tool_calls / stop
 * responses, then starts the real pobai-server pointing at the mock, and makes
 * actual HTTP requests to verify the full loop end-to-end.
 *
 * No real API key or external network calls are needed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "../src/index.mjs");

// ── Helpers ─────────────────────────────────────────────────────────────────

function getFreePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(port, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pobai-server on :${port} did not start within ${maxMs}ms`);
}

async function postJson(port, path, body) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Mock LLM server ──────────────────────────────────────────────────────────

let mockCallCount = 0;
let mockResponseQueue = [];

function toolCallsMsg(calls) {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
          })),
        },
      },
    ],
  };
}

function stopMsg(content) {
  return {
    choices: [
      { finish_reason: "stop", message: { role: "assistant", content } },
    ],
  };
}

let mockLLMServer;
let mockLLMPort;
let pobaiPort;
let pobaiProc;

beforeAll(async () => {
  mockLLMPort = await getFreePort();
  pobaiPort = await getFreePort();
  const dataDir = await mkdtemp(join(tmpdir(), "pobai-test-"));

  // Mock LLM server: serves mockResponseQueue entries in order
  mockLLMServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const response =
        mockResponseQueue[mockCallCount++] ?? stopMsg("(mock exhausted)");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  await new Promise((resolve) => mockLLMServer.listen(mockLLMPort, resolve));

  // Real pobai-server, pointed at mock LLM
  pobaiProc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      POBAI_SERVER_PORT: String(pobaiPort),
      OPENROUTER_BASE_URL: `http://localhost:${mockLLMPort}`,
      POBAI_DATA_DIR: dataDir,
      POE2_MCP_DISABLED: "1", // keep the loop test hermetic — no real poe2-mcp child
    },
    stdio: "pipe",
  });

  await waitForReady(pobaiPort);
}, 20_000);

afterAll(() => {
  pobaiProc?.kill();
  mockLLMServer?.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("/api/chat tool-use loop", () => {
  it("single tool call: LLM calls list_builds then returns final answer", async () => {
    mockCallCount = 0;
    mockResponseQueue = [
      // Round 1 — LLM requests list_builds
      toolCallsMsg([{ name: "list_builds", args: {} }]),
      // Round 2 — LLM sees empty list, produces final answer
      stopMsg("No builds imported yet. Paste a PoB2 export to get started."),
    ];

    const result = await postJson(pobaiPort, "/api/chat", {
      model: "deepseek/deepseek-chat-v3-5",
      apiKey: "test-key-no-real-call",
      messages: [{ role: "user", content: "What builds do I have?" }],
    });

    expect(result.message).toBeDefined();
    expect(result.message.content).toContain("build");
    expect(Array.isArray(result.message.toolTrace)).toBe(true);
    expect(result.message.toolTrace).toHaveLength(1);
    expect(result.message.toolTrace[0].tool).toBe("list_builds");
    expect(result.message.toolTrace[0].result).toBeInstanceOf(Array);
    expect(mockCallCount).toBe(2);
  });

  it("multi-step: LLM chains two tool calls before answering", async () => {
    mockCallCount = 0;
    mockResponseQueue = [
      // Step 1 — list_builds
      toolCallsMsg([{ name: "list_builds", args: {} }]),
      // Step 2 — list_builds again (LLM rechecks)
      toolCallsMsg([{ name: "list_builds", args: {} }]),
      // Step 3 — final answer
      stopMsg("Still no builds. Please import one first."),
    ];

    const result = await postJson(pobaiPort, "/api/chat", {
      model: "deepseek/deepseek-chat-v3-5",
      apiKey: "test-key",
      messages: [{ role: "user", content: "Double check my build list." }],
    });

    expect(result.message.toolTrace).toHaveLength(2);
    expect(result.message.toolTrace[0].tool).toBe("list_builds");
    expect(result.message.toolTrace[1].tool).toBe("list_builds");
    expect(mockCallCount).toBe(3);
  });

  it("tool results are passed back to LLM in subsequent rounds", async () => {
    // First import a build so list_builds returns something
    await postJson(pobaiPort, "/api/build/import", {
      source: "pob-xml",
      label: "Test Ranger",
      payload: `<PathOfBuilding2>
        <Build characterName="ArrowRanger" className="Ranger" level="60" />
        <PlayerStat stat="Life" value="2800" />
        <Tree treeVersion="2.1.0"><Node id="111" /><Node id="222" /></Tree>
      </PathOfBuilding2>`,
    });

    let capturedLLMBodies = [];
    // Override mock to capture request bodies
    const originalQueue = [...mockResponseQueue];
    mockCallCount = 0;
    mockResponseQueue = [
      toolCallsMsg([{ name: "list_builds", args: {} }]),
      stopMsg("You have one build: ArrowRanger."),
    ];

    const result = await postJson(pobaiPort, "/api/chat", {
      model: "deepseek/deepseek-chat-v3-5",
      apiKey: "test-key",
      messages: [{ role: "user", content: "List my builds." }],
    });

    // The tool result should contain our imported build
    const toolResult = result.message.toolTrace[0].result;
    expect(Array.isArray(toolResult)).toBe(true);
    expect(toolResult.length).toBeGreaterThanOrEqual(1);
    expect(toolResult[0].label).toBe("Test Ranger");
    expect(result.message.content).toContain("ArrowRanger");
  });

  it("stops at 8 iterations when LLM never returns stop", async () => {
    mockCallCount = 0;
    // Always return a tool call — triggers the 8-iteration safety limit
    const infiniteCall = toolCallsMsg([{ name: "list_builds", args: {} }]);
    mockResponseQueue = Array(20).fill(infiniteCall);

    const result = await postJson(pobaiPort, "/api/chat", {
      model: "deepseek/deepseek-chat-v3-5",
      apiKey: "test-key",
      messages: [{ role: "user", content: "Loop forever." }],
    });

    expect(result.message.toolTrace).toHaveLength(8);
    expect(result.message.content).toMatch(/limit/i);
    expect(mockCallCount).toBe(8);
  });

  it("demo mode (no apiKey) returns response without calling mock LLM", async () => {
    const beforeCount = mockCallCount;

    const result = await postJson(pobaiPort, "/api/chat", {
      model: "deepseek/deepseek-chat-v3-5",
      apiKey: "",
      messages: [{ role: "user", content: "Demo question." }],
    });

    expect(result.message).toBeDefined();
    expect(result.message.content).toBeTruthy();
    expect(mockCallCount).toBe(beforeCount); // LLM was NOT called
  });
});
