// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@renderer/components/ui/toast";
import { ProfileReadyBanner } from "./profile-ready-banner";

function readyBanner(completionIdentity: string) {
  return (
    <ToastProvider>
      <MemoryRouter initialEntries={["/job-finder/profile"]}>
        <Routes>
          <Route
            element={
              <ProfileReadyBanner completionIdentity={completionIdentity} />
            }
            path="/job-finder/profile"
          />
          <Route
            element={<p>Find jobs screen</p>}
            path="/job-finder/discovery"
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function toastText(): string | null {
  return document.querySelector("[data-toast]")?.textContent ?? null;
}

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

describe("ProfileReadyBanner", () => {
  it("announces core setup as a toast instead of implying full-profile readiness", () => {
    render(readyBanner("candidate_1:completion_1"));

    expect(toastText()).toContain("Core setup is ready");
    expect(toastText()).toContain("Optional details can stay empty.");
    expect(toastText()).not.toContain("ready for job search");
  });

  it("offers Find jobs as the toast's one action", () => {
    render(readyBanner("candidate_1:completion_1"));

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Find jobs" }),
    );

    expect(screen.getByText("Find jobs screen")).toBeTruthy();
  });

  it("announces a completion only once", () => {
    const view = render(readyBanner("candidate_1:completion_1"));
    expect(toastText()).toContain("Core setup is ready");

    view.unmount();
    render(readyBanner("candidate_1:completion_1"));
    expect(toastText()).toBeNull();
  });

  it("announces a different profile completion again", () => {
    const view = render(readyBanner("candidate_1:completion_1"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toastText()).toBeNull();

    view.rerender(readyBanner("candidate_2:completion_2"));

    expect(toastText()).toContain("Core setup is ready");
  });
});
