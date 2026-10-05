// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AskAssistantButton } from "./ask-assistant-button";
const openWith = vi.fn();
vi.mock("./assistant-provider", () => ({ useAssistant: () => ({ openWith }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("uses the small shared header button and preserves the attached question", () => {
  render(<AskAssistantButton prompt="Help with my profile" />);
  const button = screen.getByRole("button", { name: "Ask the assistant" });
  expect(button.dataset.size).toBe("sm");
  expect(button.className).toContain("text-sm");
  expect(button.className).toContain("h-8");
  fireEvent.click(button);
  expect(openWith).toHaveBeenCalledWith({ text: "Help with my profile" });
});
