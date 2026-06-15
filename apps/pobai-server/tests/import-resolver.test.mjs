/**
 * Unit tests for the build-import resolver: XML passthrough, PoB code decoding,
 * build-URL fetching, and poe.ninja resolution via a mocked poe2-mcp bridge.
 */
import { describe, it, expect, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { resolveToXml, ImportError, parseNinjaUrl, isPoeNinjaUrl } from "../src/import-resolver.mjs";

// A representative build, long enough that its export code exceeds the
// embedded-code detection threshold.
const XML = `<PathOfBuilding2><Build characterName="NinjaGuy" className="Monk" ascendClassName="Invoker" level="90" bandit="None"/>` +
  `<Skills><Skill label="Tempest Bell"><Gem nameSpec="Tempest Bell" level="20" quality="20"/><Gem nameSpec="Glaciation Support" level="18"/></Skill></Skills>` +
  `<Items><Item id="1" slot="Weapon 1"><Name>Ninja Staff</Name><TypeLine>Expert Quarterstaff</TypeLine></Item></Items>` +
  `<PlayerStat stat="Life" value="2500"/><Tree treeVersion="0_2"><Node id="100"/><Node id="200"/></Tree></PathOfBuilding2>`;
const CODE = deflateSync(Buffer.from(XML)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

const okFetch = (body) => vi.fn(async () => ({ ok: true, text: async () => body }));

describe("resolveToXml", () => {
  it("passes raw PoB2 XML through unchanged", async () => {
    const r = await resolveToXml(XML);
    expect(r.xml).toContain('characterName="NinjaGuy"');
  });

  it("decodes a PoB export code", async () => {
    const r = await resolveToXml(CODE);
    expect(r.xml).toContain('characterName="NinjaGuy"');
  });

  it("rewrites a pobb.in URL to /raw and decodes the code it returns", async () => {
    const fetchImpl = okFetch(CODE);
    const r = await resolveToXml("https://pobb.in/abc123", { fetchImpl });
    expect(r.xml).toContain("NinjaGuy");
    expect(fetchImpl).toHaveBeenCalledWith("https://pobb.in/abc123/raw", expect.anything());
  });

  it("resolves a URL that returns raw XML", async () => {
    const r = await resolveToXml("https://example.com/build.xml", { fetchImpl: okFetch(XML) });
    expect(r.xml).toContain("NinjaGuy");
  });

  it("errors when a fetched URL contains no PoB code", async () => {
    const fetchImpl = okFetch("<html><body>just a page</body></html>");
    await expect(resolveToXml("https://example.com/x", { fetchImpl })).rejects.toBeInstanceOf(ImportError);
  });

  it("resolves a poe.ninja URL via get_pob_code on the bridge", async () => {
    const mcp = {
      ready: true,
      callTool: vi.fn(async () => ({
        text: `Path of Building Code for NinjaGuy:\n\n${CODE}\n\nCopy this code and import it in Path of Building.`,
      })),
    };
    const r = await resolveToXml("https://poe.ninja/poe2/profile/Acc-1234/character/NinjaGuy", { mcp });
    expect(r.xml).toContain("NinjaGuy");
    expect(r.note).toMatch(/poe\.ninja via poe2-mcp/);
    expect(mcp.callTool).toHaveBeenCalledWith("get_pob_code", { account: "Acc-1234", character: "NinjaGuy" });
  });

  it("gives an actionable error when poe.ninja char isn't fetchable (bridge ready)", async () => {
    const mcp = { ready: true, callTool: vi.fn(async () => ({ text: "Could not fetch PoB code for NinjaGuy." })) };
    await expect(
      resolveToXml("https://poe.ninja/poe2/builds/character/Acc-1234/NinjaGuy", { mcp })
    ).rejects.toThrow(/public|paste the PoB code/i);
  });

  it("tells the user to enable the bridge when poe.ninja URL but bridge is down", async () => {
    await expect(
      resolveToXml("https://poe.ninja/poe2/profile/Acc/character/Foo", { mcp: { ready: false, callTool: vi.fn() } })
    ).rejects.toThrow(/poe2-mcp/i);
  });

  it("rejects unrecognizable input", async () => {
    await expect(resolveToXml("just some nonsense words")).rejects.toBeInstanceOf(ImportError);
  });
});

describe("parseNinjaUrl / isPoeNinjaUrl", () => {
  it("parses profile URLs", () => {
    expect(parseNinjaUrl("https://poe.ninja/poe2/profile/Acc-1/character/Hero"))
      .toEqual({ account: "Acc-1", character: "Hero" });
  });
  it("parses builds/character URLs", () => {
    expect(parseNinjaUrl("https://poe.ninja/poe2/builds/character/Acc-1/Hero"))
      .toEqual({ account: "Acc-1", character: "Hero" });
  });
  it("returns null for non-character poe.ninja URLs", () => {
    expect(parseNinjaUrl("https://poe.ninja/poe2/builds")).toBeNull();
  });
  it("recognizes poe.ninja hosts", () => {
    expect(isPoeNinjaUrl("https://poe.ninja/poe2/profile/x/character/y")).toBe(true);
    expect(isPoeNinjaUrl("https://pobb.in/abc")).toBe(false);
  });
});
