import type { Event, Input, WebContents } from "electron";

export const MAIN_WINDOW_MIN_ZOOM_FACTOR = 0.5;
export const MAIN_WINDOW_MAX_ZOOM_FACTOR = 2;
export const MAIN_WINDOW_DEFAULT_ZOOM_FACTOR = 1;
export const MAIN_WINDOW_ZOOM_FACTOR_STEP = 0.1;

export type MainWindowZoomCommand = "in" | "out" | "reset";

type ZoomTarget = Pick<WebContents, "getZoomFactor" | "setZoomFactor">;
// Embedded views use the same session-owned factor as the shell's shortcuts.
const zoomControllers = new WeakMap<
  ZoomTarget,
  (command: MainWindowZoomCommand) => void
>();

export type MainWindowZoomShortcutInput = Pick<
  Input,
  "alt" | "code" | "control" | "isComposing" | "key" | "meta" | "type"
>;

export function getMainWindowZoomCommand(
  input: MainWindowZoomShortcutInput,
  platform: NodeJS.Platform = process.platform,
): MainWindowZoomCommand | null {
  if (input.type !== "keyDown" || input.isComposing || input.alt) {
    return null;
  }

  const primaryModifier = platform === "darwin" ? input.meta : input.control;
  const conflictingModifier =
    platform === "darwin" ? input.control : input.meta;

  if (!primaryModifier || conflictingModifier) {
    return null;
  }

  if (
    input.key === "+" ||
    input.key === "=" ||
    input.code === "Equal" ||
    input.code === "NumpadAdd"
  ) {
    return "in";
  }

  if (
    input.key === "-" ||
    input.code === "Minus" ||
    input.code === "NumpadSubtract"
  ) {
    return "out";
  }

  if (
    input.key === "0" ||
    input.code === "Digit0" ||
    input.code === "Numpad0"
  ) {
    return "reset";
  }

  return null;
}

export function getNextMainWindowZoomFactor(
  currentFactor: number,
  command: MainWindowZoomCommand,
): number {
  if (command === "reset") {
    return MAIN_WINDOW_DEFAULT_ZOOM_FACTOR;
  }

  const safeCurrentFactor = Number.isFinite(currentFactor)
    ? currentFactor
    : MAIN_WINDOW_DEFAULT_ZOOM_FACTOR;
  const direction = command === "in" ? 1 : -1;
  const steppedFactor = Number(
    (safeCurrentFactor + direction * MAIN_WINDOW_ZOOM_FACTOR_STEP).toFixed(2),
  );

  return Math.min(
    MAIN_WINDOW_MAX_ZOOM_FACTOR,
    Math.max(MAIN_WINDOW_MIN_ZOOM_FACTOR, steppedFactor),
  );
}

function routeZoomCommand(
  event: Pick<Event, "preventDefault">,
  command: MainWindowZoomCommand | null,
  target: ZoomTarget,
): boolean {
  if (!command) return false;
  event.preventDefault();
  const controller = zoomControllers.get(target);
  if (controller) controller(command);
  else
    target.setZoomFactor(
      getNextMainWindowZoomFactor(target.getZoomFactor(), command),
    );
  return true;
}

/** Menu clicks use the same steps and owned factor as the keyboard. */
export function applyMainWindowZoomCommand(
  target: ZoomTarget,
  command: MainWindowZoomCommand,
): void {
  routeZoomCommand({ preventDefault: () => undefined }, command, target);
}

export function routeMainWindowZoomShortcut(
  event: Pick<Event, "preventDefault">,
  input: MainWindowZoomShortcutInput,
  target: ZoomTarget,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return routeZoomCommand(
    event,
    getMainWindowZoomCommand(input, platform),
    target,
  );
}

export function bindMainWindowZoomShortcuts(
  webContents: Pick<WebContents, "getZoomFactor" | "on" | "setZoomFactor">,
  platform: NodeJS.Platform = process.platform,
  options: { initialZoomFactor?: number } = {},
) {
  // Use the saved window preference unless a tester explicitly requests a
  // startup factor. Reassert it after Chromium restores route-specific zoom.
  let desiredZoomFactor =
    options.initialZoomFactor ?? MAIN_WINDOW_DEFAULT_ZOOM_FACTOR;

  webContents.setZoomFactor(desiredZoomFactor);

  const applyOwnedZoomFactor = () => {
    if (webContents.getZoomFactor() !== desiredZoomFactor) {
      webContents.setZoomFactor(desiredZoomFactor);
    }
  };

  // Commit-time host zoom restoration (fresh load, reload, recovery reload)
  // lands after the pre-load normalization above; re-assert post-load so a
  // reused user-data root can never decide the launch zoom.
  webContents.on("did-finish-load", applyOwnedZoomFactor);

  webContents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame) {
      return;
    }

    const currentFactor = webContents.getZoomFactor();
    if (Number.isFinite(currentFactor) && currentFactor > 0) {
      desiredZoomFactor = currentFactor;
    }
  });

  webContents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    // Chromium persists zoom against the complete file URL, including the hash.
    // Without restoring the pre-navigation factor, moving between Job Finder routes
    // can unexpectedly swap to an old route-specific zoom and make shell controls
    // unreachable. Keep one user-owned zoom factor for the whole desktop window.
    applyOwnedZoomFactor();
  });

  zoomControllers.set(webContents, (command) => {
    const currentFactor = webContents.getZoomFactor();
    const nextFactor = getNextMainWindowZoomFactor(currentFactor, command);

    if (nextFactor !== currentFactor) {
      desiredZoomFactor = nextFactor;
      webContents.setZoomFactor(nextFactor);
    }
  });
  webContents.on("before-input-event", (event: Event, input: Input) => {
    routeMainWindowZoomShortcut(event, input, webContents, platform);
  });
}
