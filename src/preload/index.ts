import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, AsePilotApi } from '../shared/api';
import type { PixelRequest } from '../core/types';

const api: AsePilotApi = {
  getSettings: () => ipcRenderer.invoke('asepilot:get-settings') as Promise<AppSettings>,
  saveSettings: (settings) => ipcRenderer.invoke('asepilot:save-settings', settings) as Promise<AppSettings>,
  selectImage: () => ipcRenderer.invoke('asepilot:select-image') as Promise<string | null>,
  selectAseprite: () => ipcRenderer.invoke('asepilot:select-aseprite') as Promise<string | null>,
  selectAnimationTemplate: () => ipcRenderer.invoke('asepilot:select-animation-template') as Promise<string | null>,
  selectOutputFolder: () => ipcRenderer.invoke('asepilot:select-output-folder') as Promise<string | null>,
  runPipeline: (request: PixelRequest) => ipcRenderer.invoke('asepilot:run-pipeline', request) as ReturnType<AsePilotApi['runPipeline']>,
  revealPath: (path: string) => ipcRenderer.invoke('asepilot:reveal-path', path) as Promise<void>
};

contextBridge.exposeInMainWorld('asepilot', api);
