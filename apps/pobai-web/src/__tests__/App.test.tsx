import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { App } from "../main";

const builds = [
  {
    snapshot_id: "build-1",
    label: "My Witch",
    source: "test",
    created_at: "2026-01-01T00:00:00.000Z",
    character: { className: "Witch", ascendancy: "Infernalist", level: "90" },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("App REST flows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("imports builds with the canonical payload contract", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/builds")) return jsonResponse([]);
      if (url.endsWith("/api/status")) return jsonResponse({ ok: true, pob2Bridge: { connected: false, url: "http://127.0.0.1:22804" } });
      if (url.endsWith("/api/build/import")) return jsonResponse({ snapshot_id: "new-build" });
      return jsonResponse({ error: "not found" }, 404);
    });
    globalThis.fetch = fetchMock;

    render(<App />);
    fireEvent.click(screen.getByText("+ Import"));
    const dialog = screen.getByRole("dialog", { name: "Import build" });
    fireEvent.change(within(dialog).getByPlaceholderText("Paste PoB export code, XML, or URL..."), {
      target: { value: "abc123" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("Label (optional)"), {
      target: { value: "League starter" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3001/api/build/import",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const importCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/build/import"));
    expect(importCall).toBeDefined();
    const body = JSON.parse(String(importCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ source: "pob-code", label: "League starter", payload: "abc123" });
    expect(body).not.toHaveProperty("code");
  });

  it("sends chat through REST and renders returned tool trace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/builds")) return jsonResponse(builds);
      if (url.endsWith("/api/status")) return jsonResponse({ ok: true, pob2Bridge: { connected: false, url: "http://127.0.0.1:22804" } });
      if (url.endsWith("/api/chat")) {
        return jsonResponse({
          message: {
            content: "Demo answer",
            toolTrace: [{ tool: "get_defenses", args: { snapshot_id: "build-1" }, result: { Life: "1200" } }],
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    globalThis.fetch = fetchMock;

    render(<App />);
    fireEvent.click(await screen.findByText("My Witch"));
    fireEvent.change(screen.getByPlaceholderText("Ask about this build..."), {
      target: { value: "How are my defenses?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Demo answer")).toBeTruthy();
    expect(screen.getByText("get_defenses")).toBeTruthy();

    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/chat"));
    expect(chatCall).toBeDefined();
    const body = JSON.parse(String(chatCall?.[1]?.body)) as {
      apiKey: string;
      model: string;
      snapshotId: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.apiKey).toBe("");
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.snapshotId).toBe("build-1");
    expect(body.messages).toEqual([{ role: "user", content: "How are my defenses?" }]);
  });

  it("imports the current live PoB build through the bridge export endpoint", async () => {
    const xml = "<PathOfBuilding2><Build characterName=\"LivePoB\" className=\"Ranger\" /></PathOfBuilding2>";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/builds")) return jsonResponse([]);
      if (url.endsWith("/api/status")) return jsonResponse({ ok: true, pob2Bridge: { connected: true, url: "http://127.0.0.1:22804" } });
      if (url.endsWith("/api/pob2/export")) return jsonResponse({ ok: true, buildName: "Live PoB", xml });
      if (url.endsWith("/api/build/import")) return jsonResponse({ snapshot: { id: "live-build" } }, 201);
      return jsonResponse({ error: "not found" }, 404);
    });
    globalThis.fetch = fetchMock;

    render(<App />);
    const button = await screen.findByRole("button", { name: "Import current PoB" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3001/api/pob2/export",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const importCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/build/import"));
    expect(importCall).toBeDefined();
    const body = JSON.parse(String(importCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ source: "pob-xml", label: "Live PoB", payload: xml });
  });
});
