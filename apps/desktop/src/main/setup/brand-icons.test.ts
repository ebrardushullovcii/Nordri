import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBrandIconPaths } from "./brand-icons";

describe("resolveBrandIconPaths", () => {
  it.each([
    "/project/apps/desktop",
    "/Applications/Nordri.app/Contents/Resources/app.asar",
  ])("resolves runtime images inside the app at %s", (appPath) => {
    const icon = path.join(appPath, "assets/brand/app-icon.png");
    expect(
      resolveBrandIconPaths(appPath, (filePath) => filePath === icon),
    ).toEqual({
      appIcon: icon,
      trayTemplate: path.join(appPath, "assets/brand/tray-template.png"),
      trayWhite: path.join(appPath, "assets/brand/tray-white.png"),
    });
  });

  it("finds the images when Electron starts on the bundled entry in out/main", () => {
    const icon = "/project/apps/desktop/assets/brand/app-icon.png";
    expect(
      resolveBrandIconPaths(
        "/project/apps/desktop/out/main",
        (filePath) => filePath === icon,
      )?.appIcon,
    ).toBe(icon);
  });

  it("returns null instead of a path that does not exist", () => {
    expect(resolveBrandIconPaths("/nowhere", () => false)).toBeNull();
  });
});
