// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { SavedJob } from "@nordri/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { DiscoveryAssessmentContinuation } from "./discovery-assessment-continuation";

afterEach(cleanup);

it("offers a bounded continuation and shows progress while a listing is being read", async () => {
  const jobs = Array.from(
    { length: 130 },
    (_, index) =>
      ({
        id: `unread_${index}`,
        discoveryMethod: "browser_agent",
        matchAssessment: { judgment: null },
      }) as SavedJob,
  );
  let release: () => void = () => undefined;
  const onAssess = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  render(
    <DiscoveryAssessmentContinuation
      jobs={jobs}
      isSearchRunning={false}
      onAssess={onAssess}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Assess next 20 listings" }),
  );
  expect(onAssess).toHaveBeenCalledWith("unread_0");
  expect(
    screen.getByText(/Assessing listings · 0 of 20 finished/),
  ).toBeTruthy();
  await act(() => {
    release();
    return Promise.resolve();
  });
  expect(onAssess).toHaveBeenCalledWith("unread_1");
  expect(
    screen.getByText(/Assessing listings · 1 of 20 finished/),
  ).toBeTruthy();
});

it("does not offer another assessment while discovery is running", () => {
  const job = {
    id: "unread",
    discoveryMethod: "browser_agent",
    matchAssessment: {},
  } as SavedJob;
  render(
    <DiscoveryAssessmentContinuation
      jobs={[job]}
      isSearchRunning
      onAssess={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("explains navigation and stops before the next listing after unmount", async () => {
  let release!: () => void;
  const onAssess = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const jobs = ["visible-first", "second"].map(
    (id) =>
      ({
        id,
        discoveryMethod: "browser_agent",
        matchAssessment: { judgment: null },
      }) as SavedJob,
  );
  const view = render(
    <DiscoveryAssessmentContinuation
      jobs={jobs}
      isSearchRunning={false}
      onAssess={onAssess}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Assess next 2 listings" }),
  );
  expect(
    screen.getByText(
      /Leaving this page stops the batch after the current listing/,
    ),
  ).toBeTruthy();
  view.unmount();
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(onAssess).toHaveBeenCalledExactlyOnceWith("visible-first");
});

it("uses the actual singular count and shows the service failure", async () => {
  const job = {
    id: "one",
    discoveryMethod: "browser_agent",
    matchAssessment: { judgment: null },
  } as SavedJob;
  render(
    <DiscoveryAssessmentContinuation
      jobs={[job]}
      isSearchRunning={false}
      onAssess={vi
        .fn()
        .mockRejectedValue(new Error("The AI is unavailable. Try again."))}
    />,
  );
  await act(() => {
    fireEvent.click(
      screen.getByRole("button", { name: "Assess next 1 listing" }),
    );
    return Promise.resolve();
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "The AI is unavailable. Try again.",
  );
});
