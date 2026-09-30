import {
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * Mirrors Tailwind's `xl` breakpoint. The split view also needs enough room
 * in the panes area after the assistant takes its share of the window.
 */
export const STUDIO_DESKTOP_MEDIA_QUERY = "(min-width: 80rem)";
/** Leave usable room for both the preview and the editing controls. */
const STUDIO_MIN_SPLIT_WIDTH = 880;

function subscribeToDesktopStudioLayout(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const mediaQuery = window.matchMedia(STUDIO_DESKTOP_MEDIA_QUERY);
  if (typeof mediaQuery?.addEventListener !== "function") {
    return () => {};
  }

  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function readDesktopStudioLayout(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return true;
  }

  return Boolean(window.matchMedia(STUDIO_DESKTOP_MEDIA_QUERY)?.matches);
}

/**
 * A wide window can still leave a narrow studio beside the assistant. Measure
 * the actual panes area before choosing the split view, keeping one mounted
 * preview/editor tree as the available space changes.
 */
export function useDesktopStudioLayout(
  panesRef: RefObject<HTMLElement | null>,
): boolean {
  const desktopViewport = useSyncExternalStore(
    subscribeToDesktopStudioLayout,
    readDesktopStudioLayout,
    () => true,
  );
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const panes = panesRef.current;
    if (!panes) return;
    const measure = (width: number) => {
      if (width > 0) setAvailableWidth(width);
    };
    measure(panes.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(panes);
    return () => observer.disconnect();
  }, [panesRef]);

  return (
    desktopViewport &&
    (availableWidth === null || availableWidth >= STUDIO_MIN_SPLIT_WIDTH)
  );
}
