export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Below this a page cannot lay out a form, so the size is not used. */
const MIN_USABLE = 100;

export function isUsableViewRect(rect: ViewRect): boolean {
  return rect.width > MIN_USABLE && rect.height > MIN_USABLE;
}

/**
 * The bounds a tab's native view should get on this layout pass, or null to
 * leave it as it is.
 *
 * While the browser is on screen every tab takes the on-screen viewport.
 * While it is minimized (the renderer reports 0×0) a tab keeps the size it
 * had; a tab created in that state has never had one, and a page with a 0×0
 * viewport cannot be clicked, so it gets the last usable size. The view is
 * hidden either way, so the person sees nothing change.
 */
export function resolvePageViewBounds(input: {
  viewport: ViewRect;
  current: ViewRect;
  lastUsable: ViewRect;
}): ViewRect | null {
  if (isUsableViewRect(input.viewport)) return input.viewport;
  if (isUsableViewRect(input.current)) return null;
  return input.lastUsable;
}
