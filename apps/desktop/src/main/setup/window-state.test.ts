import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getMainWindowDisplayMode,
  getMainWindowStateFilePath,
  loadMainWindowState,
  parseMainWindowState,
  resolveMainWindowBounds,
  saveMainWindowState,
} from "./window-state";

const originalUserDataDirectory = process.env.NORDRI_USER_DATA_DIR;

describe("main window state", () => {
  afterEach(() => {
    if (originalUserDataDirectory === undefined) {
      delete process.env.NORDRI_USER_DATA_DIR;
    } else {
      process.env.NORDRI_USER_DATA_DIR = originalUserDataDirectory;
    }

    vi.restoreAllMocks();
  });

  test("parses valid persisted window state", () => {
    expect(
      parseMainWindowState({
        x: 200,
        y: 120,
        width: 1440,
        height: 920,
        displayMode: "maximized",
      }),
    ).toEqual({
      x: 200,
      y: 120,
      width: 1440,
      height: 920,
      displayMode: "maximized",
    });
  });

  test("rejects invalid persisted window state payloads", () => {
    expect(
      parseMainWindowState({
        x: 200,
        y: 120,
        width: 1440,
        height: 920,
        displayMode: "zoomed",
      }),
    ).toBeNull();
  });

  test("reuses a saved position when it still intersects an attached display", () => {
    expect(
      resolveMainWindowBounds(
        {
          x: 2100,
          y: 80,
          width: 1400,
          height: 900,
          displayMode: "normal",
        },
        { width: 1440, height: 920 },
        [
          {
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          },
          {
            bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
          },
        ],
      ),
    ).toEqual({
      x: 2100,
      y: 80,
      width: 1400,
      height: 900,
    });
  });

  test("moves partially off-screen restored bounds back into the display work area", () => {
    expect(
      resolveMainWindowBounds(
        {
          x: 230,
          y: -43,
          width: 1440,
          height: 920,
          displayMode: "normal",
        },
        { width: 1440, height: 920 },
        [
          {
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          },
        ],
      ),
    ).toEqual({
      x: 230,
      y: 0,
      width: 1440,
      height: 920,
    });
  });
  test("drops an off-screen position while keeping the saved size", () => {
    expect(
      resolveMainWindowBounds(
        {
          x: 4000,
          y: 100,
          width: 1400,
          height: 900,
          displayMode: "normal",
        },
        { width: 1440, height: 920 },
        [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      ),
    ).toEqual({
      width: 1400,
      height: 900,
    });
  });

  test("round-trips the persisted state through the desktop user data directory", () => {
    const userDataDirectory = mkdtempSync(
      path.join(tmpdir(), "nordri-window-state-"),
    );
    process.env.NORDRI_USER_DATA_DIR = `  ${path.relative(
      process.cwd(),
      userDataDirectory,
    )}  `;

    saveMainWindowState({
      x: 100,
      y: 120,
      width: 1440,
      height: 920,
      displayMode: "fullscreen",
    });

    expect(loadMainWindowState()).toEqual({
      x: 100,
      y: 120,
      width: 1440,
      height: 920,
      displayMode: "fullscreen",
    });
    expect(
      JSON.parse(readFileSync(getMainWindowStateFilePath(), "utf8")),
    ).toEqual({
      x: 100,
      y: 120,
      width: 1440,
      height: 920,
      displayMode: "fullscreen",
    });
    expect(getMainWindowStateFilePath()).toBe(
      path.join(userDataDirectory, "main-window-state.json"),
    );

    rmSync(userDataDirectory, { recursive: true, force: true });
  });

  test("falls back cleanly when the saved state file is invalid JSON", () => {
    const userDataDirectory = mkdtempSync(
      path.join(tmpdir(), "nordri-window-state-"),
    );
    process.env.NORDRI_USER_DATA_DIR = userDataDirectory;
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    writeFileSync(getMainWindowStateFilePath(), "{not-json", "utf8");

    expect(loadMainWindowState()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    rmSync(userDataDirectory, { recursive: true, force: true });
  });

  test("derives the persisted display mode from the current window state", () => {
    expect(
      getMainWindowDisplayMode({
        isFullScreen: () => true,
        isMaximized: () => false,
      } as never),
    ).toBe("fullscreen");

    expect(
      getMainWindowDisplayMode({
        isFullScreen: () => false,
        isMaximized: () => true,
      } as never),
    ).toBe("maximized");

    expect(
      getMainWindowDisplayMode({
        isFullScreen: () => false,
        isMaximized: () => false,
      } as never),
    ).toBe("normal");
  });
});
