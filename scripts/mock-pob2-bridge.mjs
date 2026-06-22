import http from "node:http";

const PORT = parseInt(process.env.MOCK_BRIDGE_PORT ?? "22804", 10);

const MOCK_STATS = {
  CombinedDPS: 482_000,
  TotalDPS: 372_000,
  ChaosDPS: 18_000,
  Speed: 6.72,
  CritChance: 8.2,
  CritMultiplier: 380,
  HitChance: 96,
  Accuracy: 1890,
  Life: 3450,
  LifeUnreserved: 3200,
  LifeRegenRecovery: 86,
  EnergyShield: 240,
  EnergyShieldRecoveryCap: 240,
  EnergyShieldRegenRecovery: 12,
  Armour: 4800,
  Evasion: 14700,
  Minion: {
    CombinedDPS: 0,
    TotalDPS: 0,
    Life: 0,
  },
};

const MOCK_XML =
  "<PathOfBuilding2><Build characterName=\"PoBAI Test Build\" className=\"Ranger\" /></PathOfBuilding2>";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const origin = req.headers["origin"] ?? "unknown";

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const action = parsed?.action;
    let result;

    switch (action) {
      case "ping":
        result = {
          ok: true,
          service: "pob2-bridge",
          version: "0.2.0",
          source_addr: `127.0.0.1:${PORT}`,
        };
        break;

      case "get_calcs":
        result = { ok: true, stats: { ...MOCK_STATS } };
        break;

      case "export_build":
        result = {
          ok: true,
          buildName: "PoBAI Test Build",
          xml: MOCK_XML,
          exportCode: "MOCK-bXkgZXhwb3J0IGNvZGU=",
          stats: { ...MOCK_STATS },
        };
        break;

      case "import_build":
      case "calculate":
        if (
          typeof parsed.xml !== "string" ||
          !parsed.xml.includes("<PathOfBuilding2") ||
          !parsed.xml.includes("<Build")
        ) {
          result = { error: "xml field must contain a full PoB2 build XML document" };
        } else {
          result = {
            ok: true,
            buildName: "PoBAI Modified Build",
            stats: {
              ...MOCK_STATS,
              CombinedDPS: Math.round(MOCK_STATS.CombinedDPS * 1.08),
              Life: Math.round(MOCK_STATS.Life * 0.97),
            },
          };
        }
        break;

      default:
        result = { error: `unknown action: ${action}` };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock PoB2 bridge listening on http://127.0.0.1:${PORT}`);
  console.log("Actions: ping, get_calcs, export_build, import_build, calculate");
});
