# Research notes

## Findings

- `HivemindOverlord/poe2-mcp` is the best first MCP candidate. Its README describes an MCP server for PoE2 character analysis and optimization, with tool coverage for character data, support validation, spell/support inspection, PoB import/export, top-player comparison, and mechanics explanation.
- `PathOfBuildingCommunity/PathOfBuilding-PoE2` is the canonical PoB2 desktop build planner target.
- The PoB2 releases page shows active releases and recent calculation/data fixes, so PoBAI should display tool/build data freshness once MCP is wired.
- The browser-based PoB Web discussion confirms that running PoB2 Lua through WebAssembly is possible, but that is a larger later milestone than this scaffold.
- OpenRouter exposes an OpenAI-compatible `/api/v1/chat/completions` endpoint, which fits the proof-of-concept provider abstraction.
- The official MCP TypeScript SDK supports Node.js clients and transports, which makes it suitable for a future TypeScript server-side MCP bridge.

## Scaffold decision

The first implementation is intentionally a local web app plus local API server. It does not modify PoB2, does not mutate builds, and does not assume live PoB bridge availability. This keeps the MVP testable while leaving clear extension points for `poe2-mcp` and a PoB2 Lua addon.
