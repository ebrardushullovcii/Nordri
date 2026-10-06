// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";
afterEach(cleanup);
it("places a modal above the assistant and keeps the full viewport available", () => {
  render(
    <>
      <aside className="fixed z-[120]" aria-label="Assistant">
        Assistant
      </aside>
      <Dialog open title="Confirm changes" onClose={vi.fn()}>
        Review these changes.
      </Dialog>
    </>,
  );
  const dialog = screen.getByRole("dialog", { name: "Confirm changes" });
  expect(dialog.parentElement?.className).toContain("z-[140]");
  expect(dialog.parentElement?.className).toContain("inset-0");
  expect(document.activeElement).toBe(dialog);
});
