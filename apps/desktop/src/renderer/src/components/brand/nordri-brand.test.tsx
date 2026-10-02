// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NordriMark } from "./nordri-mark";
import { NordriWordmark } from "./nordri-wordmark";

afterEach(cleanup);

describe.each([
  ["wordmark", NordriWordmark, "52 152 2070 419"],
  ["mark", NordriMark, "0 0 1024 1024"],
] as const)("Nordri %s", (_name, Component, viewBox) => {
  it("has an accessible name and uses the theme palette", () => {
    const { getByRole } = render(<Component className="h-5 w-auto" />);
    const image = getByRole("img", { name: "Nordri" });

    expect(image.querySelector("title")?.textContent).toBe("Nordri");
    expect(image.getAttribute("viewBox")).toBe(viewBox);
    expect(image.getAttribute("focusable")).toBe("false");
    expect(image.getAttribute("class")).toBe("h-5 w-auto");
    expect(image.hasAttribute("width")).toBe(false);
    expect(image.hasAttribute("height")).toBe(false);
    expect(
      new Set(
        Array.from(image.querySelectorAll("path"), (path) =>
          path.getAttribute("fill"),
        ),
      ),
    ).toEqual(
      new Set([
        "currentColor",
        "var(--brand-stone-blue)",
        "var(--brand-stone-sage)",
      ]),
    );
  });

  it("uses a supplied title for both accessible labels", () => {
    const { getByRole } = render(<Component title="Nordri home" />);
    expect(
      getByRole("img", { name: "Nordri home" }).querySelector("title")
        ?.textContent,
    ).toBe("Nordri home");
  });
});

it("keeps the wordmark aligned to the start of its container", () => {
  const { getByRole } = render(<NordriWordmark />);
  expect(
    getByRole("img", { name: "Nordri" }).getAttribute("preserveAspectRatio"),
  ).toBe("xMinYMid meet");
});
