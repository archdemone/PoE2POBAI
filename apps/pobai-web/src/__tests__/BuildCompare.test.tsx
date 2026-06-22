import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { BuildCompare } from "../components/BuildCompare";
import type { BuildInfo } from "../types";

const builds: BuildInfo[] = [
  {
    snapshot_id: "base",
    label: "My Build",
    source: "local",
    created_at: "2026-01-01T00:00:00.000Z",
    character: { className: "Mercenary", level: "78" },
  },
  {
    snapshot_id: "target",
    label: "Guide Build",
    source: "pobb.in",
    created_at: "2026-01-02T00:00:00.000Z",
    character: { className: "Mercenary", ascendancy: "Witchhunter", level: "92" },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BuildCompare", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-posts selected builds and renders stat, skill, item, and passive differences", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      statDiffs: [
        { label: "Life", baseValue: 1000, targetValue: 1250, delta: 250, changed: true, status: "changed", color: "green" },
        { label: "Fire Resistance", baseRaw: "75%", targetRaw: "68%", delta: -7, changed: true, status: "changed", color: "red" },
      ],
      skills: {
        rows: [
          { key: "explosiveshot", status: "added", changed: true, base: null, target: { label: "Explosive Shot", gems: [{ name: "Explosive Shot" }, { name: "Martial Tempo" }] } },
        ],
      },
      items: {
        rows: [
          { key: "weapon1", status: "removed", changed: true, base: { slot: "Weapon 1", name: "Old Crossbow" }, target: null },
        ],
      },
      passiveTree: { addedNodeIds: ["1", "2", "3", "4"], removedNodeIds: ["5", "6"] },
    }));
    globalThis.fetch = fetchMock;

    render(<BuildCompare builds={builds} activeBuildId="base" apiBaseUrl="http://localhost:3001" />);

    expect(await screen.findByText("Life")).toBeTruthy();
    expect(screen.getByText("1250").classList.contains("stat-positive")).toBe(true);
    expect(screen.getByText("68%").classList.contains("stat-negative")).toBe(true);
    expect(screen.getByText("Explosive Shot")).toBeTruthy();
    expect(screen.getByText("Old Crossbow")).toBeTruthy();
    expect(screen.getByText("+4 nodes")).toBeTruthy();
    expect(screen.getByText("-2 nodes")).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/build/compare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ baseId: "base", targetId: "target" }),
      }),
    );
  });

  it("exposes live PoB import when the bridge is connected", () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}));
    const onImportCurrent = vi.fn(async () => undefined);
    render(
      <BuildCompare
        builds={builds}
        activeBuildId="base"
        apiBaseUrl="http://localhost:3001"
        pob2Connected
        bridgeUrl="http://127.0.0.1:22804"
        onImportCurrent={onImportCurrent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import current PoB" }));
    expect(onImportCurrent).toHaveBeenCalledOnce();
    expect(screen.getByText("Live PoB bridge connected")).toBeTruthy();
  });
});
