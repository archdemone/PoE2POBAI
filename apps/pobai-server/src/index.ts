import crypto from "node:crypto";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { z } from "zod";
import type { BuildSnapshot, ChatMessage, HealthResponse } from "@pobai/protocol";

const app = express();
const port = Number(process.env.POBAI_SERVER_PORT ?? 3001);
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const snapshots = new Map<string, BuildSnapshot>();

app.use(cors({ origin: process.env.POBAI_WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

const importBuildSchema = z.object({
  source: z.enum(["pob-code", "pob-xml", "poe-ninja", "ggg-profile"]),
  label: z.string().trim().min(1).max(120).optional(),
  payload: z.string().trim().min(1),
});

const chatSchema = z.object({
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1),
  snapshotId: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1),
  })).min(1),
});

app.get("/health", (_request, response) => {
  const body: HealthResponse = { ok: true, service: "pobai-server", version: "0.1.0" };
  response.json(body);
});

app.get("/api/build/current", (_request, response) => {
  response.json({ snapshots: [...snapshots.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

app.post("/api/build/import", (request, response) => {
  const parsed = importBuildSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid build import payload", details: parsed.error.flatten() });
    return;
  }

  const { source, label, payload } = parsed.data;
  const normalizedPayload = payload.replace(/\r\n/g, "\n").trim();
  const hash = crypto.createHash("sha256").update(normalizedPayload).digest("hex");
  const snapshot: BuildSnapshot = {
    id: crypto.randomUUID(),
    source,
    createdAt: new Date().toISOString(),
    label: label ?? `${source} snapshot ${new Date().toISOString()}`,
    hash,
    sizeBytes: Buffer.byteLength(normalizedPayload, "utf8"),
    preview: normalizedPayload.slice(0, 240),
  };

  snapshots.set(snapshot.id, snapshot);
  response.status(201).json({ snapshot });
});

app.get("/api/mcp/tools", (_request, response) => {
  response.json({
    connected: false,
    tools: [],
    note: "MCP client wiring is intentionally stubbed in v0.1 scaffolding; poe2-mcp integration is the next milestone.",
  });
});

app.post("/api/chat", async (request, response) => {
  const parsed = chatSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid chat request", details: parsed.error.flatten() });
    return;
  }

  const { apiKey, model, messages, snapshotId } = parsed.data;
  const snapshot = snapshotId ? snapshots.get(snapshotId) : undefined;
  const systemContext = [
    "You are PoBAI, a Path of Exile 2 build assistant proof of concept.",
    "Do not invent exact build numbers. If PoB/MCP data is unavailable, say that the scaffold has not connected those tools yet.",
    snapshot ? `Current immutable snapshot: ${snapshot.label} (${snapshot.source}, sha256 ${snapshot.hash}).` : "No build snapshot is currently selected.",
  ].join("\n");

  const openRouterResponse = await fetch(`${openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173",
      "X-OpenRouter-Title": "PoBAI Local Proof of Concept",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemContext }, ...messages],
    }),
  });

  if (!openRouterResponse.ok) {
    const detail = await openRouterResponse.text();
    response.status(openRouterResponse.status).json({ error: "OpenRouter request failed", detail });
    return;
  }

  const data = await openRouterResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "OpenRouter returned an empty response.";
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };

  response.json({ message });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`PoBAI server listening on http://0.0.0.0:${port}`);
});
