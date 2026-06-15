import { WebSocketServer } from "ws";

const MAX_TOOL_ITERATIONS = 8;

export function createWsHandler({ openRouterApiKey, poe2McpTools, localTools }) {
  const opts = { openRouterApiKey, poe2McpTools: poe2McpTools || [], localTools };

  function getToolDefs() {
    return [
      ...(opts.localTools || []).map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      ...(opts.poe2McpTools || []),
    ];
  }

  return function handleUpgrade(request, socket, head) {
    const wss = new WebSocketServer({ noServer: true });

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on("message", async (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
          return;
        }

        if (parsed.type === "chat") {
          await handleChat(ws, parsed, { openRouterApiKey, getToolDefs, localTools, poe2McpTools: opts.poe2McpTools });
        } else if (parsed.type === "tool_result") {
          // results are picked up by waitForToolResults via its own listener
        }
      });
    });
  };
}

async function handleChat(ws, { message, buildId }, { openRouterApiKey, getToolDefs, localTools, poe2McpTools }) {
  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(buildId),
    },
    { role: "user", content: message },
  ];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    if (!openRouterApiKey) {
      handleDemoLoop(ws, messages, { localTools, poe2McpTools });
      return;
    }

    const response = await callLLM(messages, getToolDefs(), openRouterApiKey);

    if (response.error) {
      ws.send(JSON.stringify({ type: "error", message: response.error }));
      return;
    }

    const choice = response.choices?.[0]?.message;
    if (!choice) {
      ws.send(JSON.stringify({ type: "error", message: "No response from LLM" }));
      return;
    }

    if (choice.content) {
      ws.send(JSON.stringify({ type: "text", content: choice.content }));
      return;
    }

    if (choice.tool_calls) {
      ws.send(JSON.stringify({
        type: "tool_calls",
        calls: choice.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || "{}"),
        })),
      }));

      messages.push({ role: "assistant", content: null, tool_calls: choice.tool_calls });

      const results = await waitForToolResults(ws);
      for (const result of results) {
        messages.push({
          role: "tool",
          tool_call_id: result.tool_call_id || result.id,
          content: JSON.stringify(result.output),
        });
      }
    } else {
      ws.send(JSON.stringify({ type: "text", content: "No content or tool calls returned." }));
      return;
    }
  }
}

function handleDemoLoop(ws, messages, { localTools, poe2McpTools }) {
  const allTools = [...(localTools || []), ...(poe2McpTools || [])];
  const toolNames = allTools.slice(0, 3).map((t) => t.name || t.function?.name).filter(Boolean);

  if (toolNames.length === 0) {
    ws.send(JSON.stringify({
      type: "text",
      content: "Demo mode: no tools available. Import a build first.",
    }));
    return;
  }

  ws.send(JSON.stringify({
    type: "tool_calls",
    calls: toolNames.map((name, i) => ({
      id: `demo_${i}`,
      name,
      args: {},
    })),
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "text",
      content: "Demo mode: tool execution simulated.",
    }));
  }, 500);
}

async function callLLM(messages, tools, apiKey) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

function waitForToolResults(ws, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tool result timeout")), timeoutMs);
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "tool_result") {
          clearTimeout(timer);
          ws.removeListener("message", handler);
          resolve(msg.results || []);
        }
      } catch {}
    };
    ws.on("message", handler);
  });
}

function buildSystemPrompt(buildId) {
  return `You are a Path of Exile 2 build advisor. Use the available tools to analyze the build with ID "${buildId}".
Key tools:
- get_build_summary: Full build overview
- get_skills: Skill gems and supports
- get_items: Equipped items by slot
- get_passive_tree: Allocated passive nodes
- get_defenses: Defense statistics

When asked for advice: call get_build_summary first, then drill into specific tools as needed. Present findings clearly.`;
}
