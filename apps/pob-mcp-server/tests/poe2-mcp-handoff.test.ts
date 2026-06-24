/**
 * Integration contract test: our get_passive_tree output → poe2-mcp inspect_passive_node
 *
 * poe2-mcp (pip install poe2-mcp) is a separate Python process; this test validates
 * our data shape so the handoff works without a live poe2-mcp instance.
 *
 * Workflow:
 *   import_pob_build → get_passive_tree → [poe2-mcp] inspect_passive_node(node_id)
 *                                        → [poe2-mcp] analyze_passive_tree(node_ids)
 */
import { describe, it, expect } from "vitest";
import { parseBuildXml } from "@pobai/parser";

const SAMPLE_XML = `<PathOfBuilding2>
  <Build characterName="Twister Deadeye" className="Ranger" ascendClassName="Deadeye" level="85" />
  <Skills>
    <Skill label="Main — Twister">
      <Gem nameSpec="Twister" level="20" />
      <Gem nameSpec="Trinity Support" support="true" level="20" />
      <Gem nameSpec="Added Cold Damage Support" support="true" level="18" />
    </Skill>
  </Skills>
  <Tree treeVersion="2.1.0" url="https://poe2.game/passive-skill-tree/AAAAA...">
    <Node id="42857" />
    <Node id="58881" />
    <Node id="12345" />
    <Node id="99001" />
    <Node id="33322" />
    <Node id="71100" />
  </Tree>
</PathOfBuilding2>`;

const XML_NO_TREE = `<PathOfBuilding2>
  <Build characterName="Empty" className="Witch" level="1" />
</PathOfBuilding2>`;

describe("poe2-mcp handoff: get_passive_tree → inspect_passive_node", () => {
  it("returns allocatedNodeIds array with correct node IDs", () => {
    const { passiveTree } = parseBuildXml(SAMPLE_XML);

    expect(passiveTree.allocatedNodeIds).toBeInstanceOf(Array);
    expect(passiveTree.allocatedNodeIds).toHaveLength(6);
    expect(passiveTree.allocatedNodeIds).toContain("42857");
    expect(passiveTree.allocatedNodeIds).toContain("58881");
    expect(passiveTree.allocatedNodeCount).toBe(6);
    expect(passiveTree.treeVersion).toBe("2.1.0");
  });

  it("node IDs are strings — poe2-mcp inspect_passive_node expects string node_id", () => {
    const { passiveTree } = parseBuildXml(SAMPLE_XML);
    for (const id of passiveTree.allocatedNodeIds ?? []) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("produces well-formed inspect_passive_node call shapes for each allocated node", () => {
    const { passiveTree } = parseBuildXml(SAMPLE_XML);
    const nodeIds = passiveTree.allocatedNodeIds ?? [];

    // Shape of what our LLM loop would forward to poe2-mcp inspect_passive_node
    const poe2McpCalls = nodeIds.map((nodeId) => ({
      tool: "inspect_passive_node",
      args: { node_id: nodeId },
    }));

    expect(poe2McpCalls).toHaveLength(6);
    expect(poe2McpCalls[0]).toMatchObject({
      tool: "inspect_passive_node",
      args: { node_id: "42857" },
    });
    // All calls must have non-empty node_id
    for (const call of poe2McpCalls) {
      expect(call.args.node_id).toBeTruthy();
    }
  });

  it("produces well-formed analyze_passive_tree call shape (batch alternative)", () => {
    const { passiveTree } = parseBuildXml(SAMPLE_XML);

    // poe2-mcp also has analyze_passive_tree which accepts an array
    const batchCall = {
      tool: "analyze_passive_tree",
      args: {
        node_ids: passiveTree.allocatedNodeIds,
        character_class: "Ranger",
      },
    };

    expect(batchCall.args.node_ids).toBeInstanceOf(Array);
    expect(batchCall.args.node_ids?.length).toBe(6);
  });

  it("handles builds with no passive tree nodes gracefully", () => {
    const { passiveTree } = parseBuildXml(XML_NO_TREE);
    expect(passiveTree.allocatedNodeIds).toBeUndefined();
    expect(passiveTree.allocatedNodeCount).toBeUndefined();
    // Safe to call — just produces an empty array for poe2-mcp
    const nodeIds = passiveTree.allocatedNodeIds ?? [];
    expect(nodeIds).toHaveLength(0);
  });

  it("allocatedNodeCount matches allocatedNodeIds length", () => {
    const { passiveTree } = parseBuildXml(SAMPLE_XML);
    expect(passiveTree.allocatedNodeCount).toBe(
      passiveTree.allocatedNodeIds?.length
    );
  });
});
