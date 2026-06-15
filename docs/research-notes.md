# Research notes

## Findings

- `HivemindOverlord/poe2-mcp` is the best first MCP candidate. Its README/search summary describes an MCP server for PoE2 character analysis and optimization, with tool coverage for character data, support validation, spell/support inspection, PoB import/export, top-player comparison, mechanics explanation, and a live PoB bridge.
- `PathOfBuildingCommunity/PathOfBuilding-PoE2` is the canonical PoB2 desktop build planner target.
- PoB2 is an offline build planner for Path of Exile 2 and remains the intended source of truth for exact calculations.
- Search results and community discussion indicate PoB export payloads can be XML-like (`<PathOfBuilding2>...`), so a lightweight local XML parser is useful as an interim MVP before MCP/PoB integration.
- OpenRouter exposes an OpenAI-compatible `/api/v1/chat/completions` endpoint, which fits the proof-of-concept provider abstraction.
- The official MCP TypeScript SDK and PoE2 MCP projects remain future integration targets, but this environment currently blocks npm/GitHub/PyPI package installation from shell commands.

## Revised scaffold decision

The implementation uses a dependency-free local Node.js server plus static browser assets. This is less fancy than a Vite/React scaffold, but it is directly runnable in this environment without npm registry access and remains easy to replace with a richer frontend later.

## Grounding decision

Until `poe2-mcp` or a PoB2 bridge is connected, PoBAI only treats parsed XML as extracted facts. Exact build math must be labeled unavailable rather than guessed.

## Current implementation note

The app now persists snapshots locally under `data/snapshots/`, keeps raw payloads server-side, and attaches evidence metadata to assistant responses. This narrows the verification gap because a user can inspect what was extracted before trusting an answer.
