import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { runPipeline } from '../core/pipeline';
import { parsePixelRequest } from '../core/schema';
import { readSettings, writeSettingsFile } from './settings';
import type { AppSettings, PipelineResultView } from '../shared/api';
import type { PipelineResult, PixelRequest } from '../core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: 'AsePilot',
    backgroundColor: '#f5f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  const settingsPath = join(app.getPath('userData'), 'settings.json');
  const projectsRoot = join(app.getPath('documents'), 'AsePilot', 'projects');

  ipcMain.handle('asepilot:get-settings', async (): Promise<AppSettings> => readSettings(settingsPath));

  ipcMain.handle('asepilot:save-settings', async (_event, settings: AppSettings): Promise<AppSettings> => {
    return writeSettingsFile(settingsPath, settings);
  });

  ipcMain.handle('asepilot:select-image', async (): Promise<string | null> => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Select reference image',
          properties: ['openFile'],
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
            }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Select reference image',
          properties: ['openFile'],
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
            }
          ]
        });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('asepilot:select-aseprite', async (): Promise<string | null> => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Select Aseprite executable',
          properties: ['openFile'],
          filters: [
            {
              name: 'Executable',
              extensions: ['exe']
            },
            {
              name: 'All files',
              extensions: ['*']
            }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Select Aseprite executable',
          properties: ['openFile'],
          filters: [
            {
              name: 'Executable',
              extensions: ['exe']
            },
            {
              name: 'All files',
              extensions: ['*']
            }
          ]
        });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('asepilot:run-pipeline', async (_event, requestValue: PixelRequest): Promise<PipelineResultView> => {
    const request = parsePixelRequest(requestValue);
    const settings = await readSettings(settingsPath);
    const result = await runPipeline({
      request,
      projectsRoot,
      asepritePath: settings.asepritePath,
      overwrite: false
    });

    return toPipelineView(result);
  });

  ipcMain.handle('asepilot:reveal-path', async (_event, targetPath: string): Promise<void> => {
    if (!targetPath.trim()) return;

    if (existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
      return;
    }

    await shell.openPath(dirname(targetPath));
  });
}

function toPipelineView(result: PipelineResult): PipelineResultView {
  const asepritePngUrl = existsSync(result.asepritePng) ? pathToFileURL(result.asepritePng).toString() : null;

  return {
    ...result,
    previewPngUrl: pathToFileURL(result.previewPng).toString(),
    referencePreviewUrl: pathToFileURL(result.previewImage).toString(),
    asepritePngUrl
  };
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
