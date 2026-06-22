import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MCP_DIR = path.join(REPO_ROOT, "apps", "pob-mcp-server");
const BRIDGE_URL = process.env.POB2_BRIDGE_URL ?? "http://127.0.0.1:22804";

let pass = 0;
let fail = 0;
let skip = 0;

function ok(label) {
  console.log(`  ok - ${label}`);
  pass++;
}

function failMsg(label, detail) {
  console.log(`  FAIL - ${label}: ${detail}`);
  fail++;
}

function skipMsg(label) {
  console.log(`  skip - ${label}`);
  skip++;
}

async function probeBridge() {
  try {
    const res = await fetch(`${BRIDGE_URL}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping" }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return { reachable: true, detail: `HTTP ${res.status}` };
    }
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      return {
        reachable: true,
        detail: body.service ? `${body.service} ${body.version ?? ""}`.trim() : "responded",
      };
    } catch {
      return { reachable: true, detail: "invalid JSON ping response" };
    }
  } catch (err) {
    return {
      reachable: false,
      detail: err?.message ?? String(err),
    };
  }
}

async function run() {
  // Set up a line-buffered reader for the child's stdout
  function lineReader(stream) {
    let buffer = "";
    return {
      next(timeout = 8000) {
        return new Promise((resolve, reject) => {
          function onData(chunk) {
            buffer += chunk.toString();
            const nl = buffer.indexOf("\n");
            if (nl !== -1) {
              clearTimeout(timer);
              stream.off("data", onData);
              const line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              resolve(line);
              return;
            }
          }
          const timer = setTimeout(() => {
            stream.off("data", onData);
            reject(new Error("Timeout"));
          }, timeout);
          stream.on("data", onData);
          // Also check if data already in buffer
          const nl = buffer.indexOf("\n");
          if (nl !== -1) {
            clearTimeout(timer);
            stream.off("data", onData);
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            resolve(line);
          }
        });
      },
      close() {
        stream.removeAllListeners("data");
      },
    };
  }

  const child = spawn(
    process.env.SHELL ?? process.comspec ?? "cmd.exe",
    ["/c", `npx tsx src/index.ts`],
    {
      cwd: MCP_DIR,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        POB2_BRIDGE_URL: process.env.POB2_BRIDGE_URL ?? "http://127.0.0.1:22804",
        PATH: process.env.PATH,
      },
    }
  );

  const reader = lineReader(child.stdout);

  try {
    // Helper: send JSON-RPC request, read response line
    let msgId = 0;
    async function send(method, params = {}) {
      msgId++;
      const req = JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n";
      child.stdin.write(req);
      const line = await reader.next();
      return JSON.parse(line);
    }

    function toolText(response) {
      return (
        response.result?.content?.[0]?.text ??
        response.error?.message ??
        JSON.stringify(response.error ?? response)
      );
    }

    function toolIsError(response) {
      return response.result?.isError === true || response.isError === true || Boolean(response.error);
    }

    const bridgeProbe = await probeBridge();
    console.log(
      `\n--- Bridge preflight ---\n  ${bridgeProbe.reachable ? "reachable" : "not running"} - ${BRIDGE_URL} (${bridgeProbe.detail})`
    );

    function checkBridgeTool(name, response, predicate, successLabel) {
      const text = toolText(response);
      const isError = toolIsError(response);
      if (isError) {
        if (!bridgeProbe.reachable && /not reachable|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|Timeout/i.test(text)) {
          skipMsg(`${name}: bridge not running`);
          return;
        }
        failMsg(name, text.substring(0, 300));
        return;
      }

      if (predicate(text)) {
        ok(successLabel);
      } else {
        failMsg(name, text.substring(0, 300));
      }
    }

    // --- 1. Initialize ---
    console.log("\n--- Initialize ---");
    let res = await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });
    if (res.result?.serverInfo?.name === "pob-mcp-server") {
      ok("initialize");
    } else {
      failMsg("initialize", JSON.stringify(res));
      return;
    }

    // Send initialized notification (no response expected)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

    // --- 2. List tools ---
    console.log("\n--- List tools ---");
    res = await send("tools/list", {});
    const tools = res.result?.tools ?? [];
    const toolNames = tools.map((t) => t.name).sort();
    const expected = [
      "delete_build", "get_build_summary", "get_defenses", "get_items",
      "get_passive_tree", "get_skills", "import_pob_build", "list_builds",
      "pob2_export_build", "pob2_get_calcs", "pob2_test_gem_swap",
      "pob2_test_item_swap", "pob2_test_passive_change",
    ].sort();
    if (JSON.stringify(toolNames) === JSON.stringify(expected)) {
      ok(`all 13 tools present`);
    } else {
      failMsg("expected 13 tools", `got ${toolNames.length}: ${toolNames.join(", ")}`);
    }

    // --- 3. Import a build ---
    console.log("\n--- Import build ---");
    res = await send("tools/call", {
      name: "import_pob_build",
      arguments: {
        code: `<PathOfBuilding2>
<Build characterName="Smoke Twister" className="Ranger" ascendClassName="Deadeye" level="72" />
<Skills>
  <Skill label="Twister main setup">
    <Gem nameSpec="Twister" level="18" quality="20" />
    <Gem nameSpec="Trinity Support" support="true" level="17" quality="20" />
    <Gem nameSpec="Inspiration Support" support="true" level="17" quality="20" />
    <Gem nameSpec="Cold Penetration Support" support="true" level="17" quality="20" />
    <Gem nameSpec="Lightning Penetration Support" support="true" level="17" quality="20" />
  </Skill>
  <Skill label="Movement">
    <Gem nameSpec="Shield Charge" level="1" />
  </Skill>
</Skills>
<Items>
  <Item id="1" slot="Weapon 1"><Name>Twister Bow</Name><TypeLine>Expert Bow</TypeLine></Item>
  <Item id="2" slot="Helm"><Name>Dragon Helmet</Name><TypeLine>Expert Helmet</TypeLine></Item>
</Items>
<PlayerStat stat="Life" value="3450" />
<Tree treeVersion="0.1.0"><Node id="101" /><Node id="54321" /><Node id="12345" /></Tree>
</PathOfBuilding2>`,
        label: "Smoke Test Build",
      },
    });
    const importText = res.result?.content?.[0]?.text ?? "{}";
    const importResult = JSON.parse(importText);
    if (importResult.snapshot_id && importResult.character?.className === "Ranger") {
      ok("import_pob_build");
    } else {
      failMsg("import_pob_build", `missing data: ${importText.substring(0, 200)}`);
    }
    const snapshotId = importResult.snapshot_id;

    // --- 4. List builds ---
    console.log("\n--- List builds ---");
    res = await send("tools/call", { name: "list_builds", arguments: {} });
    const listText = res.result?.content?.[0]?.text ?? "";
    if (listText.includes(snapshotId)) {
      ok("list_builds");
    } else {
      failMsg("list_builds", `missing snapshot: ${listText.substring(0, 200)}`);
    }

    // --- 5. Get build summary ---
    console.log("\n--- Get build summary ---");
    res = await send("tools/call", { name: "get_build_summary", arguments: { snapshot_id: snapshotId } });
    const summaryText = res.result?.content?.[0]?.text ?? "";
    if (summaryText.includes("Twister") && summaryText.includes("Ranger")) {
      ok("get_build_summary");
    } else {
      failMsg("get_build_summary", summaryText.substring(0, 200));
    }

    // --- 6. Get skills ---
    console.log("\n--- Get skills ---");
    res = await send("tools/call", { name: "get_skills", arguments: { snapshot_id: snapshotId } });
    const skillsText = res.result?.content?.[0]?.text ?? "";
    if (skillsText.includes("Twister") && skillsText.includes("Trinity Support")) {
      ok("get_skills");
    } else {
      failMsg("get_skills", skillsText.substring(0, 200));
    }

    // --- 7. Get items ---
    console.log("\n--- Get items ---");
    res = await send("tools/call", { name: "get_items", arguments: { snapshot_id: snapshotId } });
    const itemsText = res.result?.content?.[0]?.text ?? "";
    if (itemsText.includes("Twister Bow") && itemsText.includes("Weapon 1")) {
      ok("get_items");
    } else {
      failMsg("get_items", itemsText.substring(0, 200));
    }

    // --- 8. Get items filtered ---
    console.log("\n--- Get items (filtered) ---");
    res = await send("tools/call", { name: "get_items", arguments: { snapshot_id: snapshotId, slot: "Helm" } });
    const filteredText = res.result?.content?.[0]?.text ?? "";
    if (filteredText.includes("Dragon Helmet") && !filteredText.includes("Twister Bow")) {
      ok("get_items filtered by slot");
    } else {
      failMsg("get_items filtered", filteredText.substring(0, 200));
    }

    // --- 9. Get defenses ---
    console.log("\n--- Get defenses ---");
    res = await send("tools/call", { name: "get_defenses", arguments: { snapshot_id: snapshotId } });
    const defText = res.result?.content?.[0]?.text ?? "";
    if (defText.includes("Life") && defText.includes("3450")) {
      ok("get_defenses");
    } else {
      failMsg("get_defenses", defText.substring(0, 200));
    }

    // --- 10. Get passive tree ---
    console.log("\n--- Get passive tree ---");
    res = await send("tools/call", { name: "get_passive_tree", arguments: { snapshot_id: snapshotId } });
    const treeText = res.result?.content?.[0]?.text ?? "";
    if (treeText.includes("54321") && treeText.includes("101")) {
      ok("get_passive_tree");
    } else {
      failMsg("get_passive_tree", treeText.substring(0, 200));
    }

    // --- 11. Bridge: pob2_get_calcs (requires mock bridge running) ---
    console.log("\n--- Bridge: get_calcs ---");
    res = await send("tools/call", { name: "pob2_get_calcs", arguments: {} });
    checkBridgeTool(
      "pob2_get_calcs",
      res,
      (text) => text.includes("CombinedDPS"),
      "pob2_get_calcs: got stats"
    );

    // --- 12. Bridge: pob2_export_build ---
    console.log("\n--- Bridge: export_build ---");
    res = await send("tools/call", { name: "pob2_export_build", arguments: {} });
    checkBridgeTool(
      "pob2_export_build",
      res,
      (text) => text.includes("exportCode") && text.includes("PathOfBuilding2"),
      "pob2_export_build: exported full XML"
    );

    // --- 13. Bridge: reject partial XML before touching PoB2 ---
    console.log("\n--- Bridge: full XML contract ---");
    res = await send("tools/call", {
      name: "pob2_test_gem_swap",
      arguments: { build_xml: "<Skill><Gem nameSpec=\"Twister\" /></Skill>", slot_name: "Skill 1" },
    });
    const partialText = toolText(res);
    if (toolIsError(res) && partialText.includes("full PoB2 XML export")) {
      ok("pob2_test_gem_swap rejects partial Skill XML");
    } else {
      failMsg("pob2_test_gem_swap partial XML contract", partialText.substring(0, 300));
    }

    // --- 14-16. Bridge: what-if tools ---
    console.log("\n--- Bridge: what-if tools ---");
    const buildXml = "<PathOfBuilding2><Build characterName=\"PoBAI Smoke\" /></PathOfBuilding2>";
    res = await send("tools/call", {
      name: "pob2_test_gem_swap",
      arguments: { build_xml: buildXml, slot_name: "Skill 1" },
    });
    checkBridgeTool(
      "pob2_test_gem_swap",
      res,
      (text) => text.includes("tested") && text.includes("CombinedDPS"),
      "pob2_test_gem_swap: tested"
    );

    res = await send("tools/call", {
      name: "pob2_test_item_swap",
      arguments: { build_xml: buildXml, slot: "Weapon 1" },
    });
    checkBridgeTool(
      "pob2_test_item_swap",
      res,
      (text) => text.includes("tested") && text.includes("CombinedDPS"),
      "pob2_test_item_swap: tested"
    );

    res = await send("tools/call", {
      name: "pob2_test_passive_change",
      arguments: { build_xml: buildXml, note: "Added nodes" },
    });
    checkBridgeTool(
      "pob2_test_passive_change",
      res,
      (text) => text.includes("tested") && text.includes("CombinedDPS"),
      "pob2_test_passive_change: tested"
    );

    // --- 17. Delete the build ---
    console.log("\n--- Delete build ---");
    res = await send("tools/call", { name: "delete_build", arguments: { snapshot_id: snapshotId } });
    const delText = res.result?.content?.[0]?.text ?? "";
    if (delText.includes("deleted")) {
      ok("delete_build");
    } else {
      failMsg("delete_build", delText.substring(0, 200));
    }

  } finally {
    child.kill();
    reader.close();
  }

  console.log(`\n${pass + skip + fail} checks: ${pass} passed, ${skip} skipped, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Smoke test crashed:", err.message);
  process.exit(1);
});
