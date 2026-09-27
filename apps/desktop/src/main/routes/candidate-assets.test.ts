import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
}));

import { CandidateAssetLibrary } from "../services/job-finder/candidate-asset-library";
import { registerCandidateAssetRouteHandlers } from "./candidate-assets";

type RouteHandler = (
  event: IpcMainInvokeEvent,
  payload?: unknown,
) => Promise<unknown>;

describe("candidate asset IPC routes", () => {
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  test("validates import/list/delete/restore payloads and returns renderer-safe metadata", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "candidate-assets-route-"),
    );
    const sourcePath = path.join(temporaryDirectory, "portfolio.pdf");
    await writeFile(sourcePath, "%PDF-1.7\nportfolio\n%%EOF", "utf8");
    const handlers = new Map<string, RouteHandler>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: RouteHandler) => {
        handlers.set(channel, handler);
      }),
    } as unknown as IpcMain;
    const library = new CandidateAssetLibrary(
      path.join(temporaryDirectory, "library"),
    );
    registerCandidateAssetRouteHandlers(ipcMain, {
      library,
      selectFile: () => Promise.resolve(sourcePath),
    });
    const event = { sender: {} } as IpcMainInvokeEvent;

    const imported = await handlers.get("job-finder:candidate-assets:import")!(
      event,
      {
        kind: "portfolio",
        sensitivity: "sensitive",
        consentScope: "private_storage_only",
        retention: "until_deleted",
      },
    );
    expect(imported).toMatchObject({
      status: "imported",
      asset: { originalName: "portfolio.pdf" },
    });
    expect(imported).not.toHaveProperty("asset.path");

    const listed = (await handlers.get("job-finder:candidate-assets:list")!(
      event,
      {},
    )) as { assets: Array<{ id: string }> };
    expect(listed.assets).toHaveLength(1);

    await handlers.get("job-finder:candidate-assets:delete")!(event, {
      assetId: listed.assets[0]!.id,
    });
    expect(
      await handlers.get("job-finder:candidate-assets:list")!(event, {}),
    ).toEqual({ assets: [] });
    await expect(
      handlers.get("job-finder:candidate-assets:restore")!(event, {
        assetId: listed.assets[0]!.id,
      }),
    ).rejects.toBeTruthy();
    const restored = await handlers.get("job-finder:candidate-assets:restore")!(
      event,
      {
        assetId: listed.assets[0]!.id,
        retention: "90_days",
      },
    );
    expect(restored).toMatchObject({
      asset: {
        id: listed.assets[0]!.id,
        retention: "90_days",
        deletedAt: null,
      },
    });
    await expect(
      handlers.get("job-finder:candidate-assets:import")!(event, {
        kind: "not-a-kind",
      }),
    ).rejects.toBeTruthy();
  });

  test("returns a typed cancellation without receiving a renderer file path", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "candidate-assets-route-"),
    );
    const handlers = new Map<string, RouteHandler>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: RouteHandler) =>
        handlers.set(channel, handler),
      ),
    } as unknown as IpcMain;
    registerCandidateAssetRouteHandlers(ipcMain, {
      library: new CandidateAssetLibrary(
        path.join(temporaryDirectory, "library"),
      ),
      selectFile: () => Promise.resolve(null),
    });

    await expect(
      handlers.get("job-finder:candidate-assets:import")!(
        { sender: {} } as IpcMainInvokeEvent,
        { kind: "resume" },
      ),
    ).resolves.toEqual({ status: "cancelled" });
  });

  test("tells waiting applications when an attachable file is added or restored", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "candidate-assets-route-"),
    );
    const sourcePath = path.join(temporaryDirectory, "portfolio.pdf");
    await writeFile(sourcePath, "%PDF-1.7\nportfolio\n%%EOF", "utf8");
    const handlers = new Map<string, RouteHandler>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: RouteHandler) =>
        handlers.set(channel, handler),
      ),
    } as unknown as IpcMain;
    const onApplicationFileAvailable = vi.fn(() => Promise.resolve(1));
    registerCandidateAssetRouteHandlers(ipcMain, {
      library: new CandidateAssetLibrary(
        path.join(temporaryDirectory, "library"),
      ),
      selectFile: () => Promise.resolve(sourcePath),
      onApplicationFileAvailable,
    });
    const event = { sender: {} } as IpcMainInvokeEvent;

    // A private-only file is not one the applications may attach.
    await handlers.get("job-finder:candidate-assets:import")!(event, {
      kind: "portfolio",
      consentScope: "private_storage_only",
    });
    expect(onApplicationFileAvailable).not.toHaveBeenCalled();

    const imported = (await handlers.get("job-finder:candidate-assets:import")!(
      event,
      { kind: "portfolio", consentScope: "job_application_attachment" },
    )) as { asset: { id: string } };
    expect(onApplicationFileAvailable).toHaveBeenCalledTimes(1);
    expect(onApplicationFileAvailable).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: imported.asset.id, kind: "portfolio" }),
    );

    await handlers.get("job-finder:candidate-assets:delete")!(event, {
      assetId: imported.asset.id,
    });
    expect(onApplicationFileAvailable).toHaveBeenCalledTimes(1);
    await handlers.get("job-finder:candidate-assets:restore")!(event, {
      assetId: imported.asset.id,
      retention: "until_deleted",
    });
    expect(onApplicationFileAvailable).toHaveBeenCalledTimes(2);
    expect(onApplicationFileAvailable).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: imported.asset.id, deletedAt: null }),
    );
  });
});
