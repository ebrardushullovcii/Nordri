import { existsSync } from "node:fs";
import path from "node:path";

export interface BrandIconPaths {
  appIcon: string;
  trayTemplate: string;
  trayWhite: string;
}

/**
 * The runtime brand images under `assets/brand`. The app path is the desktop
 * package in `electron-vite dev` and in a packaged asar, but `out/main` when
 * Electron is started on the bundled entry file directly (the test harnesses
 * and the demo seed do this), so the parent folders are tried too. Null when
 * no folder has the images: callers keep Electron's defaults rather than fail
 * to start over an icon.
 */
export function resolveBrandIconPaths(
  appPath: string,
  fileExists: (filePath: string) => boolean = existsSync,
): BrandIconPaths | null {
  const candidates = [
    appPath,
    path.dirname(appPath),
    path.resolve(appPath, "../.."),
  ];
  for (const root of candidates) {
    const brandDirectory = path.join(root, "assets", "brand");
    const paths = {
      appIcon: path.join(brandDirectory, "app-icon.png"),
      trayTemplate: path.join(brandDirectory, "tray-template.png"),
      trayWhite: path.join(brandDirectory, "tray-white.png"),
    };
    if (fileExists(paths.appIcon)) return paths;
  }
  return null;
}
