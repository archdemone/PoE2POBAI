import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "../components/DiffView";

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
    expect(document.body.textContent).toContain("Skills Removed");
    expect(document.body.textContent).toContain("Twister");
  });

  it("shows skills added", () => {
    const diff = {
      ...baseDiff,
      skillsAdded: [{ label: "Fireball", gems: ["Fireball", "Controlled Destruction"] }],
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Skills Added");
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
    expect(document.body.textContent).toContain("Items Removed");
    expect(document.body.textContent).toContain("Items Added");
    expect(document.body.textContent).toContain("Old Staff");
    expect(document.body.textContent).toContain("New Staff");
  });

  it("shows defenses changed", () => {
    const diff = {
      ...baseDiff,
      defensesChanged: { Life: { from: "4000", to: "4500" }, ES: { from: "200", to: "0" } },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Defenses Changed");
    expect(document.body.textContent).toContain("Life");
    expect(document.body.textContent).toContain("4000");
    expect(document.body.textContent).toContain("4500");
  });

  it("shows passive tree changes", () => {
    const diff = {
      ...baseDiff,
      passivesChanged: { nodesAdded: 3, nodesRemoved: 1 },
    };
    render(<DiffView diff={diff} />);
    expect(document.body.textContent).toContain("Passive Tree Changed");
    expect(document.body.textContent).toContain("+3");
    expect(document.body.textContent).toContain("-1");
  });
});
