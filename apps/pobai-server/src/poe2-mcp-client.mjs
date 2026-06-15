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
 * TODO when home: run `pip install poe2-mcp` and restart the server to verify connection.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class Poe2McpClient {
  constructor() {
    this._client = null;
    this.tools = [];
    this.ready = false;
    this._reconnectTimer = null;
  }

  async connect() {
    try {
      const transport = new StdioClientTransport({
        command: "poe2-mcp",
        args: [],
      });

      this._client = new Client(
        { name: "pobai", version: "0.2.0" },
        { capabilities: {} }
      );

      await this._client.connect(transport);
      const { tools } = await this._client.listTools();
      this.tools = tools;
      this.ready = true;
      console.log(`[poe2-mcp] Connected — ${tools.length} tools available`);
      return true;
    } catch (error) {
      this.ready = false;
      this._client = null;
      console.warn(
        `[poe2-mcp] Not available — install with: pip install poe2-mcp\n` +
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
