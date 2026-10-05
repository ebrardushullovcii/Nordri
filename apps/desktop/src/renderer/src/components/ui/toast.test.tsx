// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function Trigger() {
  const { showToast } = useToast();
  return (
    <button
      onClick={() =>
        showToast({
          title: "Jobs hidden",
          action: { label: "Undo", onClick: vi.fn() },
        })
      }
    >
      Hide jobs
    </button>
  );
}
it("keeps bulk Undo available for twenty seconds and holds it on hover", async () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText("Hide jobs"));
  await act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  fireEvent.mouseEnter(screen.getByRole("status"));
  await act(() => vi.advanceTimersByTime(20000));
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  fireEvent.mouseLeave(screen.getByRole("status"));
  await act(() => vi.advanceTimersByTime(20000));
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("sits above list pagers without resizing the page while it shows", () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText("Hide jobs"));
  const viewport = document.querySelector("[data-toast-viewport]");
  // Clear of the one-line pager at the bottom of a list panel.
  expect(viewport?.className).toContain("bottom-16");
  // Showing a toast never moves the content under the person's pointer.
  expect(
    document.documentElement.style.getPropertyValue("--toast-reserved-height"),
  ).toBe("");
});
