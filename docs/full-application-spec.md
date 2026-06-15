# PoBAI full application spec

## Product goal

PoBAI is a local-first Path of Building 2 assistant. A player imports a fresh PoB2 build snapshot, asks build questions in a chat UI, and receives grounded answers that clearly separate extracted build facts, PoB/MCP-calculated facts, and AI inference.

## Current MVP target

The MVP must be runnable from this repository with no package installation. It should let a user:

1. Start the app with `npm run dev` or `node apps/pobai-server/src/index.mjs`.
2. Open `http://localhost:3001`.
3. Paste a PoB XML export or PoB code.
4. Import an immutable snapshot.
5. See a parsed summary when XML contains recognizable character, item, skill, gem, tree, or stat data.
6. Ask questions through either local demo mode or OpenRouter.

## Grounding rules

PoBAI must never pretend to have exact Path of Building calculations when the PoB/MCP bridge is unavailable.

Every answer should distinguish:

- `Extracted from snapshot`: facts parsed from the imported XML/payload.
- `Unavailable until MCP/PoB bridge`: DPS, exact damage conversion, exact eHP, exact mitigation, exact skill hit breakdowns, and support compatibility validation.
- `Inference`: qualitative suggestions based on incomplete extracted data.

## Architecture

```text
Browser UI
  -> local Node.js server
    -> immutable snapshot store
    -> XML/payload parser
    -> build summary context builder
    -> OpenRouter proxy or local demo responder
    -> future MCP client boundary
      -> poe2-mcp / PoB2 bridge / wiki tools
```

## Data model

A snapshot contains:

- id
- source
- createdAt
- label
- hash
- sizeBytes
- preview
- parsed summary

The raw payload stays server-side in local persisted storage. The browser receives metadata and parsed summary only.

## Parsed summary fields

- character: class, ascendancy, level, league, name when available
- skills: skill groups and gems when available
- items: item names/types/slots when available
- passiveTree: tree URL/hash/count metadata when available
- defenses: life, energy shield, armour, evasion, block, resistances when visible in exported data
- warnings: parsing limitations and missing source-of-truth calculations

## MVP chat behavior

When OpenRouter key is provided:

- Send a strict system prompt.
- Include snapshot summary context.
- Tell the model not to invent exact numbers.

When no OpenRouter key is provided:

- Return a deterministic local response.
- Mention relevant extracted fields.
- Say what cannot be answered until MCP/PoB integration exists.

## Future MCP milestones

1. Connect to `poe2-mcp` and expose `/api/mcp/tools` with real tool metadata.
2. Route mechanics questions to wiki/mechanics tools.
3. Route support gem questions to support validation tools.
4. Route exact build math to PoB import/calculation tools.
5. Add a PoB2 bridge/addon that exports the current build into PoBAI.
6. Add experiment snapshots, diffs, and explicit apply/export flows.

## Safety requirements

- Imported snapshots are immutable and persisted locally until deleted by the user.
- Direct live PoB2 mutation is disabled until clone/diff/revert is implemented.
- The UI must warn users to re-import after manual PoB edits.
- Assistant responses should expose an evidence panel with extracted facts and unavailable calculations.
- Exact numerical claims require PoB/MCP output.
