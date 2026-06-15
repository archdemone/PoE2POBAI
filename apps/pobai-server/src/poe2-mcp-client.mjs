/**
 * Thin MCP client that proxies calls to a locally-installed poe2-mcp process.
 *
 * poe2-mcp is a Python package (pip install poe2-mcp) that exposes 38 live
 * Path of Exile 2 tools: gem DB, DPS calculator, passive tree lookup, trade search, etc.
 *
 * This module is optional — the HTTP server starts fine without it.
 * When poe2-mcp is installed and running, its tools are automatically merged
 * into the LLM tool-use loop alongside our 6 local PoB parse tools.
 *
 * Launch: the PyPI package ships a `poe2-mcp` console script, but its entry
 * point (src.mcp_server:main) frequently isn't on PATH, so by default we run
 * it as a Python module via the platform Python launcher. Override the
 * executable with POE2_MCP_COMMAND (and optionally POE2_MCP_ARGS), or disable
 * the integration entirely with POE2_MCP_DISABLED=1.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomBytes } from "node:crypto";

const DEFAULT_PYTHON = process.platform === "win32" ? "py" : "python3";

/**
 * Resolve how to launch poe2-mcp: command, args, and the env it needs.
 * poe2-mcp's config makes SECRET_KEY and ENCRYPTION_KEY required — without
 * them it raises on import (the "Connection closed" failure). They only sign/
 * encrypt local trade-auth data we don't use, so a random per-launch value is
 * fine unless the user pins their own via the environment.
 */
function resolvePoe2McpLaunch() {
  const command = process.env.POE2_MCP_COMMAND ?? DEFAULT_PYTHON;
  const args = process.env.POE2_MCP_ARGS !== undefined
    ? process.env.POE2_MCP_ARGS.split(" ").filter(Boolean)
    : process.env.POE2_MCP_COMMAND
      ? []
      : ["-m", "src.mcp_server"];
  const env = {
    ...process.env,
    SECRET_KEY: process.env.SECRET_KEY ?? randomBytes(32).toString("hex"),
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? randomBytes(32).toString("hex"),
  };
  return { command, args, env };
}

export class Poe2McpClient {
  constructor() {
    this._client = null;
    this.tools = [];
    this.ready = false;
    this._reconnectTimer = null;
  }

  async connect() {
    if (["1", "true", "yes"].includes((process.env.POE2_MCP_DISABLED ?? "").toLowerCase())) {
      console.log("[poe2-mcp] Disabled via POE2_MCP_DISABLED — using local PoB parse tools only.");
      return false;
    }
    const { command, args, env } = resolvePoe2McpLaunch();
    try {
      const transport = new StdioClientTransport({
        command,
        args,
        env,
        stderr: "ignore", // poe2-mcp logs verbosely to stderr; MCP protocol is on stdout
      });

      this._client = new Client(
        { name: "pobai", version: "0.2.0" },
        { capabilities: {} }
      );

      await this._client.connect(transport);
      const { tools } = await this._client.listTools();
      this.tools = tools;
      this.ready = true;
      console.log(`[poe2-mcp] Connected via "${command} ${args.join(" ")}" — ${tools.length} tools available`);
      return true;
    } catch (error) {
      this.ready = false;
      this._client = null;
      console.warn(
        `[poe2-mcp] Not connected — live game tools disabled (using local PoB parse tools only).\n` +
        `  Tried: ${command} ${args.join(" ")}\n` +
        `  Install with: pip install poe2-mcp  (or set POE2_MCP_COMMAND / POE2_MCP_DISABLED=1)\n` +
        `  Reason: ${error.message}`
      );
      return false;
    }
  }

  async callTool(name, args) {
    if (!this.ready || !this._client) {
      throw new Error(
        `poe2-mcp not connected. Install with: pip install poe2-mcp, then restart the server.`
      );
    }
    const result = await this._client.callTool({ name, arguments: args ?? {} });
    // MCP tools return { content: [{ type: "text", text: "..." }] }
    // Try to parse as JSON, fall back to raw text object
    const textContent = result.content?.find((c) => c.type === "text")?.text ?? "";
    try {
      return JSON.parse(textContent);
    } catch {
      return { text: textContent };
    }
  }

  /** OpenAI-format tool definitions for the LLM tool-use loop */
  toLlmToolDefinitions() {
    return this.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  get toolNames() {
    return this.tools.map((t) => t.name);
  }
}
