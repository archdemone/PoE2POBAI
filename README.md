# PoBAI

PoBAI is a proof-of-concept local web assistant for Path of Building 2 snapshots. The first version focuses on manual import of a fresh PoB2 build payload, OpenRouter-backed chat, and a clean boundary for adding `poe2-mcp`/PoB calculation tools next.

## Current scope

- Vite + React web UI at `apps/pobai-web`.
- Express local API server at `apps/pobai-server`.
- Shared TypeScript protocol package at `packages/pobai-protocol`.
- Immutable in-memory build snapshot import endpoint.
- OpenRouter-compatible chat endpoint.
- Stub MCP tools endpoint for the next integration milestone.

## Run locally

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The API server listens on <http://localhost:3001>.

## Environment variables

Create a local `.env` file if you want to override defaults:

```bash
POBAI_SERVER_PORT=3001
POBAI_WEB_ORIGIN=http://localhost:5173
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=http://localhost:5173
VITE_POBAI_API_URL=http://localhost:3001
```

The OpenRouter API key is entered in the web UI for the proof of concept and is sent only to the local API server request handler.

## Snapshot safety model

PoBAI treats imported builds as immutable snapshots. If you manually change a build in PoB2, import a fresh PoB code/XML payload before asking for advice. Direct mutation of a live PoB2 build is intentionally out of scope for this first scaffold.

## Next milestones

1. Connect the server to `poe2-mcp` and list available MCP tools.
2. Call PoE2 mechanics/wiki/support-gem validation tools from chat.
3. Add PoB code decompression/import through MCP rather than parsing XML only.
4. Add PoB2 Lua bridge integration under `integrations/pob2-addon`.
5. Add experimental snapshot clone/diff/revert flows for safe recommendations.
