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

  it("auto-posts selected builds and renders the stat sheet plus skill, item, and passive differences", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      stats: {
        rows: [
          { key: "life", label: "Life", baseValue: 1000, targetValue: 1250, status: "changed" },
          { key: "fireresist", label: "Fire", baseValue: 75, targetValue: 68, status: "changed" },
        ],
      },
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

    // Stat sheet renders the curated character-sheet rows...
    expect(await screen.findByText("Life")).toBeTruthy();
    expect(screen.getByText("Fire")).toBeTruthy();
    // ...and the diverging bar for Life is the "target has more" (red) verdict.
    const lifeRow = screen.getByText("Life").closest(".cmp-ds");
    expect(lifeRow?.classList.contains("cmp-tg")).toBe(true);
    // The detailed swap checklist (DiffView) still shows skills / items / passives.
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

  it("does not swap slots when a second build is imported (becomes the active build)", async () => {
    // Reproduces the reported bug: import your build (A) first, then a guide
    // build (B). Importing B makes it the active build. The "My build" slot must
    // stay A and the new build must flow into "Build to copy", not swap in.
    const witch: BuildInfo = {
      snapshot_id: "A", label: "A - My Witch", source: "pob-xml", created_at: "2026-01-01T00:00:00.000Z",
      character: { className: "Witch", ascendancy: "Infernalist", level: "90" },
    };
    const merc: BuildInfo = {
      snapshot_id: "B", label: "B - Guide Merc", source: "pob-xml", created_at: "2026-01-02T00:00:00.000Z",
      character: { className: "Mercenary", ascendancy: "Witchhunter", level: "95" },
    };
    globalThis.fetch = vi.fn(async () => jsonResponse({}));

    // Step 1: only "my" build imported -> it is the active build -> seeds "My build".
    const { rerender } = render(
      <BuildCompare builds={[witch]} activeBuildId="A" apiBaseUrl="http://localhost:3001" />,
    );
    const baseSelect = () => screen.getByLabelText("1. My build") as HTMLSelectElement;
    const targetSelect = () => screen.getByLabelText("2. Build to copy") as HTMLSelectElement;
    expect(baseSelect().value).toBe("A");

    // Step 2: import the guide build -> it becomes the active build.
    rerender(<BuildCompare builds={[witch, merc]} activeBuildId="B" apiBaseUrl="http://localhost:3001" />);

    await waitFor(() => expect(targetSelect().value).toBe("B"));
    expect(baseSelect().value).toBe("A"); // still my build, not swapped
    expect(targetSelect().value).toBe("B"); // guide build is the one to copy
  });

  it("flows a freshly imported build into 'Build to copy' even when one is already selected", async () => {
    // Reproduces the reported bug: a placeholder/guide build already sits in the
    // compare-against slot, then the user imports the real guide build. The new
    // build becomes the active build and must take over "Build to copy" — the old
    // selection must not stick (which made re-importing look like a no-op).
    const mine: BuildInfo = {
      snapshot_id: "A", label: "My character", source: "pob-code", created_at: "2026-01-01T00:00:00.000Z",
      character: { className: "Monk", ascendancy: "Martial Artist", level: "91" },
    };
    const placeholder: BuildInfo = {
      snapshot_id: "B", label: "Build to compare", source: "pob-code", created_at: "2026-01-02T00:00:00.000Z",
      character: { className: "Monk", ascendancy: "Martial Artist", level: "96" },
    };
    const realGuide: BuildInfo = {
      snapshot_id: "C", label: "pob-code snapshot", source: "pob-code", created_at: "2026-01-03T00:00:00.000Z",
      character: { className: "Sorceress", ascendancy: "Stormweaver", level: "94" },
    };
    globalThis.fetch = vi.fn(async () => jsonResponse({}));

    const { rerender } = render(
      <BuildCompare builds={[mine, placeholder]} activeBuildId="A" apiBaseUrl="http://localhost:3001" />,
    );
    const baseSelect = () => screen.getByLabelText("1. My build") as HTMLSelectElement;
    const targetSelect = () => screen.getByLabelText("2. Build to copy") as HTMLSelectElement;
    await waitFor(() => expect(targetSelect().value).toBe("B"));

    // Import the real guide build -> it becomes the active build.
    rerender(<BuildCompare builds={[mine, placeholder, realGuide]} activeBuildId="C" apiBaseUrl="http://localhost:3001" />);

    await waitFor(() => expect(targetSelect().value).toBe("C"));
    expect(baseSelect().value).toBe("A"); // my build stays pinned
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
