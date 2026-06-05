import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
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
  const defaultProjectsRoot = join(app.getPath('documents'), 'AsePilot', 'projects');

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

  ipcMain.handle('asepilot:select-animation-template', async (): Promise<string | null> => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Select animation template',
      properties: ['openFile'],
      filters: [
        {
          name: 'Aseprite or image templates',
          extensions: ['aseprite', 'ase', 'png', 'jpg', 'jpeg', 'webp']
        },
        {
          name: 'All files',
          extensions: ['*']
        }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('asepilot:select-output-folder', async (): Promise<string | null> => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Select AsePilot output folder',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Select AsePilot output folder',
          properties: ['openDirectory', 'createDirectory']
        });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('asepilot:run-pipeline', async (_event, requestValue: PixelRequest): Promise<PipelineResultView> => {
    const request = parsePixelRequest(requestValue);
    const settings = await readSettings(settingsPath);
    const projectsRoot = settings.outputRoot.trim() || defaultProjectsRoot;
    const result = await runPipeline({
      request,
      projectsRoot,
      agentProvider: {
        providerId: settings.agentProvider,
        cliCommand: settings.cliCommand,
        openAiApiKey: settings.openAiApiKey,
        openAiBaseUrl: settings.openAiBaseUrl,
        openAiModel: settings.openAiModel
      },
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

async function toPipelineView(result: PipelineResult): Promise<PipelineResultView> {
  const asepritePngUrl = existsSync(result.asepritePng) ? await imageFileToDataUrl(result.asepritePng) : null;

  return {
    ...result,
    previewPngUrl: await imageFileToDataUrl(result.previewPng),
    referencePreviewUrl: await imageFileToDataUrl(result.previewImage),
    asepritePngUrl
  };
}

async function imageFileToDataUrl(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const mimeType = imageMimeType(filePath);

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function imageMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
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
