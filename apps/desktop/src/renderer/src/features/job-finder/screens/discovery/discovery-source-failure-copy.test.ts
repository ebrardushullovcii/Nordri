import { expect, it } from "vitest";
import { discoverySourceFailureCopy } from "./discovery-source-failure-copy";

it("keeps the recorded reason and removes browser logs and terminal colours", () => {
  expect(
    discoverySourceFailureCopy("The source stopped responding.\nMore notes."),
  ).toBe("The source stopped responding.");
  const readable = discoverySourceFailureCopy(
    "page.goto: Timeout 30000ms exceeded. Call log: \u001b[2m waiting for navigation",
  );
  expect(readable).not.toContain("page.goto");
  expect(readable).not.toContain("\u001b");
  expect(readable).toBeTruthy();
});
