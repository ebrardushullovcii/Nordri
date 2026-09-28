// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireJobFinderOverlay,
  resetJobFinderOverlaysForTests,
} from "../job-finder/lib/job-finder-overlay-ownership";
import { InterviewDeleteSessionDialog } from "./interview-delete-session-dialog";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetJobFinderOverlaysForTests();
});

function renderDialog(overrides?: { pending?: boolean }) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const appRoot = document.createElement("div");
  appRoot.id = "root";
  const trigger = document.createElement("button");
  trigger.textContent = "Delete session";
  appRoot.append(trigger);
  document.body.append(appRoot);
  trigger.focus();

  const rendered = render(
    <InterviewDeleteSessionDialog
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      open
      pending={overrides?.pending ?? false}
    />,
  );

  return { appRoot, onCancel, onConfirm, rendered, trigger };
}

describe("InterviewDeleteSessionDialog", () => {
  it("opens as an alert dialog, isolates the page, and starts on Cancel", () => {
    const { appRoot } = renderDialog();

    expect(
      screen.getByRole("alertdialog", {
        name: "Delete this interview session?",
      }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(appRoot.getAttribute("aria-hidden")).toBe("true");
    expect(appRoot.hasAttribute("inert")).toBe(true);
  });

  it("cancels with Escape and restores focus when it closes", () => {
    const { onCancel, rendered, trigger } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();

    rendered.rerender(
      <InterviewDeleteSessionDialog
        error={null}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        open={false}
        pending={false}
      />,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab focus and requires the explicit destructive action", () => {
    const { onCancel, onConfirm } = renderDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", {
      name: "Delete permanently",
    });

    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cannot dismiss while deletion is pending", () => {
    const { onCancel, onConfirm } = renderDialog({ pending: true });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("alertdialog"));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
        .disabled,
    ).toBe(true);
    const confirmButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete permanently",
    });
    // Pending keeps the destructive control exposed but inert (aria-disabled +
    // aria-busy) instead of natively disabled, so focus survives deletion.
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    expect(confirmButton.getAttribute("aria-disabled")).toBe("true");
    expect(confirmButton.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the original trigger for focus restoration across pending and failure states", () => {
    const { onCancel, onConfirm, rendered, trigger } = renderDialog();

    rendered.rerender(
      <InterviewDeleteSessionDialog
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        pending
      />,
    );
    rendered.rerender(
      <InterviewDeleteSessionDialog
        error="Could not delete this session. Nothing was removed. Try again."
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        pending={false}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Could not delete this session. Nothing was removed. Try again.",
    );
    const alertDialog = screen.getByRole("alertdialog", {
      name: "Delete this interview session?",
    });
    const describedByIds =
      alertDialog.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedByIds).toHaveLength(2);
    expect(document.getElementById(describedByIds[1] ?? "")?.textContent).toBe(
      "Could not delete this session. Nothing was removed. Try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    rendered.rerender(
      <InterviewDeleteSessionDialog
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
        open={false}
        pending={false}
      />,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("allows retrying the destructive action after a failure", () => {
    const { onConfirm, rendered, onCancel } = renderDialog();

    rendered.rerender(
      <InterviewDeleteSessionDialog
        error="Could not delete this session. Nothing was removed. Try again."
        onCancel={onCancel}
        onConfirm={onConfirm}
        open
        pending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("defers Escape to an overlay opened above it, then closes on its own Escape", () => {
    const { onCancel } = renderDialog();

    const higherLayer = acquireJobFinderOverlay(vi.fn());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete this interview session?",
      }),
    ).toBeTruthy();

    higherLayer.release();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("ignores Escape that another handler already consumed or IME composition owns", () => {
    const { onCancel } = renderDialog();

    const blocked = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    blocked.preventDefault();
    document.dispatchEvent(blocked);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(document, {
      isComposing: true,
      key: "Escape",
      keyCode: 229,
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete this interview session?",
      }),
    ).toBeTruthy();
  });
});
