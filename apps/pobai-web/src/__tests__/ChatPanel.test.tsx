import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ChatPanel } from "../components/ChatPanel";

describe("ChatPanel", () => {
  it("renders messages", () => {
    render(<ChatPanel messages={[{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]} onSend={vi.fn()} disabled={false} />);
    expect(document.body.textContent).toContain("hello");
    expect(document.body.textContent).toContain("hi");
  });

  it("calls onSend on click", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} disabled={false} />);
    const input = document.querySelector("input")!;
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.click(document.querySelector("button")!);
    expect(onSend).toHaveBeenCalledWith("test");
  });

  it("does not send empty message", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} disabled={false} />);
    fireEvent.click(document.querySelector("button")!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables input when disabled", () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} disabled={true} />);
    expect(document.querySelector("input")!.disabled).toBe(true);
  });
});