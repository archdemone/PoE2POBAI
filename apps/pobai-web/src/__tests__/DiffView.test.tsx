import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView, type BuildCompareResult } from "../components/DiffView";

const baseDiff = {
  baseId: "abc",
  targetId: "xyz",
  skillsAdded: [],
  skillsRemoved: [],
  itemsAdded: [],
  itemsRemoved: [],
  defensesChanged: {},
  passivesChanged: { nodesAdded: 0, nodesRemoved: 0 },
};

describe("DiffView", () => {
  it("shows empty state when no differences", () => {
    const { container } = render(<DiffView diff={baseDiff} />);
    expect(container.textContent).toContain("No differences between these builds");
  });

  it("shows skills removed", () => {
    const diff = {
      ...baseDiff,
      skillsRemoved: [{ label: "Twister", gems: ["Twister"] }],
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Skills only in my build");
    expect(document.body.textContent).toContain("Twister");
  });

  it("shows skills added", () => {
    const diff = {
      ...baseDiff,
      skillsAdded: [{ label: "Fireball", gems: ["Fireball", "Controlled Destruction"] }],
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Skills to add from target");
    expect(document.body.textContent).toContain("Fireball");
    expect(document.body.textContent).toContain("Controlled Destruction");
  });

  it("shows items removed and added", () => {
    const diff = {
      ...baseDiff,
      itemsRemoved: [{ slot: "Weapon 1", name: "Old Staff" }],
      itemsAdded: [{ slot: "Weapon 1", name: "New Staff" }],
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Items only in my build");
    expect(document.body.textContent).toContain("Items to equip from target");
    expect(document.body.textContent).toContain("Old Staff");
    expect(document.body.textContent).toContain("New Staff");
  });

  it("shows defenses changed", () => {
    const diff = {
      ...baseDiff,
      defensesChanged: { Life: { from: "4000", to: "4500" }, ES: { from: "200", to: "0" } },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Stat differences");
    expect(document.body.textContent).toContain("Life");
    expect(document.body.textContent).toContain("4000");
    expect(document.body.textContent).toContain("4500");
  });

  it("shows passive tree changes", () => {
    const diff: BuildCompareResult = {
      ...baseDiff,
      passivesChanged: { nodesAdded: 3, nodesRemoved: 1 },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Passive tree to copy");
    expect(document.body.textContent).toContain("+3");
    expect(document.body.textContent).toContain("-1");
  });

  it("renders near-equal stats as neutral/white with a matched tag", () => {
    const diff: BuildCompareResult = {
      ...baseDiff,
      statDiffs: [
        { label: "Block", baseValue: 250, targetValue: 252, delta: 2, near: true, status: "near", color: "neutral" },
      ],
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("≈ matched");
    expect(screen.getByText("252").classList.contains("stat-neutral")).toBe(true);
  });

  it("renders per-gem add / drop / relevel for changed skill groups", () => {
    const diff: BuildCompareResult = {
      ...baseDiff,
      skills: {
        rows: [
          {
            key: "la",
            status: "changed",
            changed: true,
            base: { label: "Lightning Arrow", gems: [{ name: "Chain" }, { name: "Lightning Arrow", level: 20 }] },
            target: { label: "Lightning Arrow", gems: [{ name: "Fork" }, { name: "Lightning Arrow", level: 21 }] },
            gemDiff: {
              added: [{ name: "Fork" }],
              removed: [{ name: "Chain" }],
              changed: [{ name: "Lightning Arrow", base: { name: "Lightning Arrow", level: 20 }, target: { name: "Lightning Arrow", level: 21 } }],
            },
          },
        ],
      },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Skill groups to update");
    expect(document.body.textContent).toContain("+ Fork");
    expect(document.body.textContent).toContain("− Chain");
    expect(document.body.textContent).toContain("Lightning Arrow");
  });

  it("renders enriched passive node names and stats grouped by type", () => {
    const diff: BuildCompareResult = {
      ...baseDiff,
      passivesChanged: undefined,
      passiveTree: {
        addedNodeIds: ["52"],
        removedNodeIds: ["55"],
        sharedNodeCount: 1,
        treeDataVersion: { version: "0_5", exact: true },
        nodesToAllocate: {
          named: 1,
          total: 1,
          groups: { keystone: [{ id: "52", name: "Zealot's Oath", type: "keystone", stats: ["Energy Shield does not Recharge"] }] },
        },
        nodesToRemove: {
          named: 1,
          total: 1,
          groups: { notable: [{ id: "55", name: "Fast Acting Toxins", type: "notable", stats: ["Damaging Ailments deal damage 12% faster"] }] },
        },
      },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Allocate (in the build to copy)");
    expect(document.body.textContent).toContain("Zealot's Oath");
    expect(document.body.textContent).toContain("Energy Shield does not Recharge");
    expect(document.body.textContent).toContain("Fast Acting Toxins");
    expect(document.body.textContent).toContain("Keystones (1)");
  });

  it("renders the backend compare response shape", () => {
    const diff: BuildCompareResult = {
      base: { id: "base", label: "Mine" },
      target: { id: "target", label: "Guide" },
      statDiffs: [
        { label: "Life", baseValue: 3200, targetValue: 4100, delta: 900, percentDelta: 28.125, changed: true, status: "changed", color: "green" },
        { label: "FireResist", baseRaw: "75", targetRaw: "63", delta: -12, changed: true, status: "changed", color: "red" },
        { label: "Armour", baseValue: 1000, targetValue: 1000, delta: 0, changed: false, status: "unchanged", color: "neutral" },
      ],
      skills: {
        rows: [
          { key: "twister", status: "changed", changed: true, base: { label: "Twister", gems: [{ name: "Twister" }] }, target: { label: "Twister", gems: [{ name: "Twister" }, { name: "Trinity Support" }] } },
          { key: "blink", status: "added", changed: true, base: null, target: { label: "Blink", gems: [{ name: "Blink" }] } },
        ],
      },
      items: {
        rows: [
          { key: "weapon1", status: "removed", changed: true, base: { slot: "Weapon 1", name: "Old Bow" }, target: null },
        ],
      },
      passiveTree: {
        addedNodeIds: ["10", "11"],
        removedNodeIds: ["9"],
      },
    };

    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Life");
    expect(document.body.textContent).toContain("+900");
    expect(document.body.textContent).toContain("+28.13%");
    expect(document.body.textContent).toContain("FireResist");
    expect(document.body.textContent).toContain("-12");
    expect(document.body.textContent).not.toContain("Armour");
    expect(document.body.textContent).toContain("Blink");
    expect(document.body.textContent).toContain("Old Bow");
    expect(document.body.textContent).toContain("+2 nodes");
    expect(document.body.textContent).toContain("-1 nodes");
  });
});
