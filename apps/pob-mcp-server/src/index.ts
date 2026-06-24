import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseBuild, isPobCode } from "@pobai/parser";
import { SnapshotStore } from "./snapshot-store.js";

const store = new SnapshotStore();

const POB2_BRIDGE_URL =
  process.env.POB2_BRIDGE_URL ?? "http://127.0.0.1:22804";

async function callBridge(
  action: string,
  body?: Record<string, unknown>
): Promise<{ error?: string; stats?: unknown; [key: string]: unknown }> {
  try {
    const res = await fetch(`${POB2_BRIDGE_URL}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(body ?? {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { error: `PoB2 bridge returned HTTP ${res.status}` };
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: `PoB2 bridge returned invalid JSON: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return {
      error: `PoB2 bridge not reachable at ${POB2_BRIDGE_URL}: ${(err as Error)?.message ?? err}`,
    };
  }
}

function nestedStatsError(data: { stats?: unknown }): string | undefined {
  if (
    data.stats &&
    typeof data.stats === "object" &&
    "error" in data.stats &&
    typeof data.stats.error === "string"
  ) {
    return data.stats.error;
  }
  return undefined;
}

function bridgeError(
  data: { error?: string; stats?: unknown },
  options: { requireStats?: boolean } = {}
): string | undefined {
  if (data.error) return data.error;
  const statsError = nestedStatsError(data);
  if (statsError) return `PoB2 bridge calculation failed: ${statsError}`;
  if (options.requireStats && data.stats == null) {
    return "PoB2 bridge did not return calculated stats.";
  }
  return undefined;
}

function isFullPob2BuildXml(xml: string): boolean {
  return (
    /<\s*PathOfBuilding2(?:\s|>)/i.test(xml) &&
    /<\s*Build(?:\s|\/|>)/i.test(xml)
  );
}

function fullBuildXmlError() {
  return {
    content: [
      {
        type: "text" as const,
        text:
          "build_xml must be a full PoB2 XML export containing <PathOfBuilding2> and <Build>. " +
          "Partial <Skill>, <Item>, or passive fragments are intentionally rejected because the current bridge imports whole builds and does not support patching fragments safely.",
      },
    ],
    isError: true,
  };
}

const server = new McpServer({
  name: "pob-mcp-server",
  version: "0.1.0",
});

server.tool(
  "import_pob_build",
  "Import a Path of Building 2 build from a PoB export code (base64) or raw XML. " +
    "Returns a snapshot_id used by all other tools.",
  {
    code: z.string().describe("PoB export code (base64) or raw PoB2 XML"),
    label: z
      .string()
      .max(120)
      .optional()
      .describe("Human-readable label for this build"),
  },
  async ({ code, label }) => {

    const source = isPobCode(code) ? "pob-code" : "pob-xml";
    const { xml, summary } = parseBuild(code);
    const snapshot = await store.save(xml, summary, label, source);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              snapshot_id: snapshot.id,
              label: snapshot.label,
              source: snapshot.source,
              character: summary.character,
              skills_count: summary.skills.length,
              items_count: summary.items.length,
              passive_node_count: summary.passiveTree.allocatedNodeCount,
              warnings: summary.warnings,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "list_builds",
  "List all PoB2 builds imported in this session.",
  {},
  async () => {

    const snapshots = store.list().map((s) => ({
      snapshot_id: s.id,
      label: s.label,
      source: s.source,
      created_at: s.createdAt,
      character: s.summary.character,
    }));
    return {
      content: [
        {
          type: "text",
          text:
            snapshots.length === 0
              ? "No builds imported yet. Use import_pob_build first."
              : JSON.stringify(snapshots, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_build_summary",
  "Get a full summary of an imported build: character, skills, items, defenses, and passive tree.",
  {
    snapshot_id: z
      .string()
      .describe("The snapshot_id returned by import_pob_build"),
  },
  async ({ snapshot_id }) => {

    const snapshot = store.get(snapshot_id);
    if (!snapshot) {
      return {
        content: [
          { type: "text", text: `No build found with snapshot_id: ${snapshot_id}` },
        ],
        isError: true,
      };
    }
    const { summary } = snapshot;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              snapshot_id: snapshot.id,
              label: snapshot.label,
              source: snapshot.source,
              character: summary.character,
              skills: summary.skills,
              items: summary.items,
              defenses: summary.defenses,
              passive_tree: summary.passiveTree,
              detected_terms: summary.detectedTerms,
              warnings: summary.warnings,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_skills",
  "Get all skill groups and their gems from an imported build.",
  {
    snapshot_id: z
      .string()
      .describe("The snapshot_id returned by import_pob_build"),
  },
  async ({ snapshot_id }) => {

    const snapshot = store.get(snapshot_id);
    if (!snapshot) {
      return {
        content: [
          { type: "text", text: `No build found with snapshot_id: ${snapshot_id}` },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              skills: snapshot.summary.skills,
              warnings: snapshot.summary.warnings.filter((w) =>
                w.includes("skill")
              ),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_items",
  "Get equipped items from an imported build, optionally filtered by slot name.",
  {
    snapshot_id: z
      .string()
      .describe("The snapshot_id returned by import_pob_build"),
    slot: z
      .string()
      .optional()
      .describe(
        'Filter by slot name (e.g. "Weapon 1", "Helm", "Body Armour"). Case-insensitive partial match.'
      ),
  },
  async ({ snapshot_id, slot }) => {

    const snapshot = store.get(snapshot_id);
    if (!snapshot) {
      return {
        content: [
          { type: "text", text: `No build found with snapshot_id: ${snapshot_id}` },
        ],
        isError: true,
      };
    }
    const items = slot
      ? snapshot.summary.items.filter((item) =>
          item.slot?.toLowerCase().includes(slot.toLowerCase())
        )
      : snapshot.summary.items;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ items, slot_filter: slot ?? null }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_passive_tree",
  "Get passive skill tree info for an imported build (tree URL, version, allocated node count, and all allocated node IDs). " +
    "Use the returned node IDs with poe2-mcp's inspect_passive_node tool for full node details.",
  {
    snapshot_id: z
      .string()
      .describe("The snapshot_id returned by import_pob_build"),
  },
  async ({ snapshot_id }) => {

    const snapshot = store.get(snapshot_id);
    if (!snapshot) {
      return {
        content: [
          { type: "text", text: `No build found with snapshot_id: ${snapshot_id}` },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(snapshot.summary.passiveTree, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_defenses",
  "Get defense statistics from an imported build (life, energy shield, resistances, armour, evasion, block, etc.). " +
    "Values are extracted from the PoB2 XML export — exact eHP and mitigation require the PoB2 calculation bridge.",
  {
    snapshot_id: z
      .string()
      .describe("The snapshot_id returned by import_pob_build"),
  },
  async ({ snapshot_id }) => {

    const snapshot = store.get(snapshot_id);
    if (!snapshot) {
      return {
        content: [
          { type: "text", text: `No build found with snapshot_id: ${snapshot_id}` },
        ],
        isError: true,
      };
    }
    const { defenses, warnings } = snapshot.summary;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              defenses,
              note:
                Object.keys(defenses).length === 0
                  ? "No defense stats in XML. Exact values require PoB2 calculation bridge."
                  : "Extracted from PoB2 XML export. Exact eHP/mitigation needs PoB2 calculation bridge.",
              warnings: warnings.filter((w) => w.includes("defense")),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "delete_build",
  "Delete an imported build by snapshot_id.",
  {
    snapshot_id: z.string().describe("The snapshot_id to delete"),
  },
  async ({ snapshot_id }) => {

    const deleted = await store.delete(snapshot_id);
    return {
      content: [
        {
          type: "text",
          text: deleted
            ? `Build ${snapshot_id} deleted successfully.`
            : `No build found with snapshot_id: ${snapshot_id}`,
        },
      ],
      isError: !deleted,
    };
  }
);

// --- PoB2 live bridge tools ---

server.tool(
  "pob2_get_calcs",
  "Get the current PoB2 build's exact calculated stats (CombinedDPS, Life, Energy Shield, Armour, Evasion, " +
    "LifeRegenRecovery, Minion DPS, etc.). Requires PoB2 running with the bridge addon installed.",
  {},
  async () => {
    const data = await callBridge("get_calcs");
    const error = bridgeError(data, { requireStats: true });
    if (error) {
      return {
        content: [{ type: "text", text: error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ stats: data.stats }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "pob2_export_build",
  "Export the current PoB2 build as full XML and export code. Returns build data and current calculated stats. " +
    "Use this to capture a full-build baseline before testing changes; the current bridge does not accept partial Skill or Item XML.",
  {},
  async () => {
    const data = await callBridge("export_build");
    const error = bridgeError(data, { requireStats: true });
    if (error) {
      return {
        content: [{ type: "text", text: error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "pob2_test_gem_swap",
  "Test a gem swap by importing a full modified PoB2 build XML document and returning recalculated stats. " +
    "Do not pass partial <Skill> XML; the current bridge only imports whole builds and may replace the active PoB2 build until you restore the original XML.",
  {
    build_xml: z
      .string()
      .describe("Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with the swapped gem(s) already applied"),
    slot_name: z
      .string()
      .describe("Which skill group slot was modified (e.g. 'Skill 1')"),
  },
  async ({ build_xml, slot_name }) => {
    if (!isFullPob2BuildXml(build_xml)) return fullBuildXmlError();
    const data = await callBridge("import_build", { xml: build_xml });
    const error = bridgeError(data, { requireStats: true });
    if (error) {
      return {
        content: [{ type: "text", text: error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "tested",
              note: `Tested gem swap in slot "${slot_name}"`,
              stats: data.stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "pob2_test_item_swap",
  "Test an item swap by importing a full modified PoB2 build XML document and returning recalculated stats. " +
    "Do not pass partial <Item> XML; the current bridge only imports whole builds and may replace the active PoB2 build until you restore the original XML.",
  {
    build_xml: z
      .string()
      .describe("Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with the replacement item already applied"),
    slot: z
      .string()
      .describe("Equipment slot being replaced (e.g. 'Weapon 1', 'Helm', 'Body Armour')"),
  },
  async ({ build_xml, slot }) => {
    if (!isFullPob2BuildXml(build_xml)) return fullBuildXmlError();
    const data = await callBridge("import_build", { xml: build_xml });
    const error = bridgeError(data, { requireStats: true });
    if (error) {
      return {
        content: [{ type: "text", text: error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "tested",
              note: `Tested item swap in slot "${slot}"`,
              stats: data.stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "pob2_test_passive_change",
  "Test passive tree changes by importing a full modified PoB2 build XML document and returning recalculated stats. " +
    "Do not pass partial passive fragments; the current bridge only imports whole builds and may replace the active PoB2 build until you restore the original XML.",
  {
    build_xml: z
      .string()
      .describe("Full PoB2 XML export containing <PathOfBuilding2> and <Build>, with modified passive tree nodes already applied"),
    note: z
      .string()
      .optional()
      .describe("Description of what nodes were changed"),
  },
  async ({ build_xml, note }) => {
    if (!isFullPob2BuildXml(build_xml)) return fullBuildXmlError();
    const data = await callBridge("import_build", { xml: build_xml });
    const error = bridgeError(data, { requireStats: true });
    if (error) {
      return {
        content: [{ type: "text", text: error }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "tested",
              note: note ?? "Tested passive tree change",
              stats: data.stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await store.init();
await server.connect(transport);
