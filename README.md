# PoBAI

PoBAI is a local-first proof-of-concept assistant for Path of Building 2 snapshots. It lets you import a fresh PoB2 payload, parse whatever build facts are visible in exported XML, and chat against that snapshot through either OpenRouter or deterministic local demo mode.

## Why this scaffold is dependency-free

The first scaffold used npm packages, but this environment could not install dependencies from the npm registry. To keep the project testable here and easy for you to run at home, the current proof of concept uses only built-in Node.js APIs plus static browser JavaScript. No `npm install` is required.

## Current scope

- Static web UI at `apps/pobai-web`.
- Plain Node.js local API/static-file server at `apps/pobai-server`.
- Immutable persisted build snapshot import endpoint under `data/snapshots/`.
- Lightweight PoB XML parser for character metadata, skill groups/gems, item names/slots, passive tree metadata, and defense-like exported stats.
- Parsed snapshot summary in the UI so you can verify what PoBAI understood before asking questions.
- XML/text file upload, persisted snapshot list, snapshot selection, and snapshot deletion.
- OpenRouter-compatible chat endpoint with strict snapshot context.
- Local grounded demo chat mode when no OpenRouter API key is provided.
- Evidence panels on assistant responses showing extracted facts and unavailable PoB/MCP calculations.
- Stub MCP tools endpoint for the next integration milestone.

## Run locally

```bash
npm run dev
```

Then open <http://localhost:3001>. The same Node.js process serves both the web UI and API.

You can also run the server directly:

```bash
node apps/pobai-server/src/index.mjs
```

## Try it without your own PoB export

1. Open <http://localhost:3001>.
2. Click **Load sample XML**.
3. Click **Import immutable snapshot**.
4. Ask: `Why are my defenses low?`
5. Leave the OpenRouter key blank to test deterministic local demo mode.

## Smoke test

With the server running, use another terminal:

```bash
npm run smoke
```

The smoke test checks the health endpoint, imports a sample immutable XML snapshot, verifies parsed class/skill/defense fields, checks persisted snapshot listing, checks the summary endpoint, sends a demo-mode defense question with evidence metadata, and deletes the smoke-test snapshot.

## Environment variables

```bash
POBAI_SERVER_PORT=3001
POBAI_SERVER_HOST=0.0.0.0
POBAI_DATA_DIR=./data/snapshots
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=http://localhost:3001
```

The OpenRouter API key is entered in the web UI for the proof of concept and is sent only to the local API server request handler. If you leave it empty, PoBAI uses local demo mode so the interface can still be tested without external API calls.

## Snapshot safety model

PoBAI treats imported builds as immutable snapshots and persists them locally under `data/snapshots/`. If you manually change a build in PoB2, import a fresh PoB code/XML payload before asking for advice. Direct mutation of a live PoB2 build is intentionally out of scope for this first scaffold.

## Important limitations

The current XML parser is intentionally lightweight. It can extract visible XML facts, but exact PoB calculations are not available until the MCP/PoB bridge is integrated. PoBAI must not invent exact DPS, eHP, damage conversion percentages, ailment chances, mitigation, or support compatibility results without PoB/MCP output.

## Next milestones

1. Connect the server to `poe2-mcp` and list available MCP tools.
2. Call PoE2 mechanics/wiki/support-gem validation tools from chat.
3. Add PoB code decompression/import through MCP rather than parsing XML only.
4. Add PoB2 Lua bridge integration under `integrations/pob2-addon`.
5. Add experimental snapshot clone/diff/revert flows for safe recommendations.
