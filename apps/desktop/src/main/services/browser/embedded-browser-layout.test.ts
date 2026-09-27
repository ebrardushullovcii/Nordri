import { describe, expect, it } from "vitest";
import { resolvePageViewBounds } from "./embedded-browser-layout";

const lastUsable = { x: 50, y: 130, width: 1100, height: 640 };
const zero = { x: 0, y: 0, width: 0, height: 0 };

describe("resolvePageViewBounds", () => {
  it("gives every tab the on-screen viewport while the browser is shown", () => {
    const viewport = { x: 10, y: 20, width: 1243, height: 675 };
    expect(
      resolvePageViewBounds({ viewport, current: zero, lastUsable }),
    ).toEqual(viewport);
  });

  it("keeps a tab's size while the browser is minimized", () => {
    expect(
      resolvePageViewBounds({
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        current: { x: 10, y: 20, width: 1243, height: 675 },
        lastUsable,
      }),
    ).toBeNull();
  });

  it("sizes a tab created while the browser is minimized so its page can be clicked", () => {
    expect(
      resolvePageViewBounds({
        viewport: { x: 0, y: 0, width: 1, height: 1 },
        current: zero,
        lastUsable,
      }),
    ).toEqual(lastUsable);
  });
});
