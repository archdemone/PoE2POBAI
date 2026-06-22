import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
