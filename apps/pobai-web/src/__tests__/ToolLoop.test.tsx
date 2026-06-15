import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ToolLoop } from "../components/ToolLoop";

describe("ToolLoop", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<ToolLoop tools={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows running tool", () => {
    const tools = [{ id: "1", name: "get_defenses", args: { snapshot_id: "abc" }, status: "running" as const, result: null }];
    render(<ToolLoop tools={tools} />);
    expect(document.body.textContent).toContain("get_defenses");
    expect(document.body.textContent).toContain("Running");
  });

  it("shows completed tool", () => {
    const tools = [{ id: "1", name: "get_defenses", args: {}, status: "complete" as const, result: { life: 4500 } }];
    render(<ToolLoop tools={tools} />);
    expect(document.body.textContent).toContain("Complete");
  });

  it("shows error state", () => {
    const tools = [{ id: "1", name: "get_items", args: {}, status: "error" as const, result: null, error: "Not found" }];
    render(<ToolLoop tools={tools} />);
    expect(document.body.textContent).toContain("Error");
    expect(document.body.textContent).toContain("Not found");
  });

  it("shows multiple tools", () => {
    const tools = [
      { id: "1", name: "get_defenses", args: {}, status: "complete" as const, result: {} },
      { id: "2", name: "get_items", args: {}, status: "running" as const, result: null },
    ];
    const { container } = render(<ToolLoop tools={tools} />);
    expect(container.querySelectorAll(".tool-loop-item").length).toBe(2);
  });
});