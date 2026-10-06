import {
  app,
  type BrowserWindow,
  screen,
  type Display,
  type Rectangle,
} from "electron";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveDesktopUserDataDirectory } from "./user-data-directory";

export type MainWindowDisplayMode = "normal" | "maximized" | "fullscreen";

export type MainWindowState = Rectangle & {
  displayMode: MainWindowDisplayMode;
  zoomFactor?: number;
};

export type RestoredMainWindowBounds = Pick<Rectangle, "width" | "height"> &
  Partial<Pick<Rectangle, "x" | "y">>;

const mainWindowStateFileName = "main-window-state.json";

function getDesktopUserDataDirectory() {
  return resolveDesktopUserDataDirectory(app);
}

export function getMainWindowStateFilePath() {
  return path.join(getDesktopUserDataDirectory(), mainWindowStateFileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMainWindowDisplayMode(
  value: unknown,
): value is MainWindowDisplayMode {
  return value === "normal" || value === "maximized" || value === "fullscreen";
}

function isMissingFileError(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function doRectanglesIntersect(first: Rectangle, second: Rectangle) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function clampBoundsToArea(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);

  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

export function parseMainWindowState(value: unknown): MainWindowState | null {
  if (!isRecord(value)) {
    return null;
  }

  const { x, y, width, height, displayMode, zoomFactor } = value;

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    width <= 0 ||
    !isFiniteNumber(height) ||
    height <= 0 ||
    !isMainWindowDisplayMode(displayMode)
  ) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    displayMode,
    ...(isFiniteNumber(zoomFactor) && zoomFactor > 0 ? { zoomFactor } : {}),
  };
}

export function loadMainWindowState() {
  try {
    const rawState = JSON.parse(
      readFileSync(getMainWindowStateFilePath(), "utf8"),
    ) as unknown;

    return parseMainWindowState(rawState);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    console.warn("[Desktop] Failed to read main window state.", error);
    return null;
  }
}

export function saveMainWindowState(state: MainWindowState) {
  try {
    const filePath = getMainWindowStateFilePath();
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(state);

    mkdirSync(path.dirname(filePath), { recursive: true });

    const tempFileHandle = openSync(tempPath, "w");

    try {
      writeFileSync(tempFileHandle, payload, "utf8");
      fsyncSync(tempFileHandle);
    } finally {
      closeSync(tempFileHandle);
    }

    renameSync(tempPath, filePath);
  } catch (error) {
    console.warn("[Desktop] Failed to persist main window state.", error);
  }
}

export function getMainWindowDisplayMode(
  window: Pick<BrowserWindow, "isFullScreen" | "isMaximized">,
): MainWindowDisplayMode {
  if (window.isFullScreen()) {
    return "fullscreen";
  }

  if (window.isMaximized()) {
    return "maximized";
  }

  return "normal";
}

export function resolveMainWindowBounds(
  savedState: MainWindowState | null,
  defaultBounds: Pick<Rectangle, "width" | "height">,
  displays: Array<Pick<Display, "bounds"> & Partial<Pick<Display, "workArea">>>,
  /**
   * The primary display's usable area (without the menu bar and Dock). A
   * first-launch or off-screen size is fitted to it: 1440x920 on a 13-inch
   * laptop put the bottom of the window, the assistant's input among it,
   * behind the Dock.
   */
  primaryWorkArea?: Pick<Rectangle, "width" | "height">,
): RestoredMainWindowBounds {
  const fitToPrimary = (size: Pick<Rectangle, "width" | "height">) =>
    primaryWorkArea
      ? {
          width: Math.min(size.width, primaryWorkArea.width),
          height: Math.min(size.height, primaryWorkArea.height),
        }
      : { width: size.width, height: size.height };

  if (!savedState) {
    return fitToPrimary(defaultBounds);
  }

  const savedBounds = {
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
  };

  const matchingDisplay = displays.find((display) =>
    doRectanglesIntersect(savedBounds, display.bounds),
  );

  if (matchingDisplay) {
    return clampBoundsToArea(
      savedBounds,
      matchingDisplay.workArea ?? matchingDisplay.bounds,
    );
  }

  return fitToPrimary(savedState);
}

export function restoreMainWindowBounds(
  defaultBounds: Pick<Rectangle, "width" | "height">,
  savedState = loadMainWindowState(),
) {
  return resolveMainWindowBounds(
    savedState,
    defaultBounds,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay().workArea,
  );
}

export function bindMainWindowStatePersistence(window: BrowserWindow) {
  let normalBounds = window.getBounds();

  const updateNormalBounds = () => {
    if (!window.isMaximized() && !window.isFullScreen()) {
      normalBounds = window.getBounds();
    }
  };

  const persistWindowState = () => {
    updateNormalBounds();
    saveMainWindowState({
      ...normalBounds,
      displayMode: getMainWindowDisplayMode(window),
      zoomFactor: window.webContents.getZoomFactor(),
    });
  };

  window.on("move", updateNormalBounds);
  window.on("resize", updateNormalBounds);
  window.on("close", persistWindowState);
}
