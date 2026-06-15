import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseBuild, isPobCode } from "./pob-parser.js";
import { SnapshotStore } from "./snapshot-store.js";

const store = new SnapshotStore();

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
    await store.init();
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
    await store.init();
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
    await store.init();
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
    await store.init();
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
    await store.init();
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
    await store.init();
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
    await store.init();
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
    await store.init();
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

const transport = new StdioServerTransport();
await store.init();
await server.connect(transport);
