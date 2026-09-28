import type { IpcMain } from "electron";
import { registerLiveAssistantRouteHandlers } from "../routes/live-assistant";

export function registerLiveAssistantDesktopRoutes(ipcMain: IpcMain) {
  registerLiveAssistantRouteHandlers(ipcMain);
}
