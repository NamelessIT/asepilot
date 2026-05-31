import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppSettings } from '../shared/api';

const DEFAULT_SETTINGS: AppSettings = {
  asepritePath: process.env.ASEPRITE_PATH ?? '',
  outputRoot: ''
};

export async function readSettings(settingsPath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      ...DEFAULT_SETTINGS,
      asepritePath: typeof parsed.asepritePath === 'string' ? parsed.asepritePath : DEFAULT_SETTINGS.asepritePath,
      outputRoot: typeof parsed.outputRoot === 'string' ? parsed.outputRoot : DEFAULT_SETTINGS.outputRoot
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeSettingsFile(settingsPath: string, settings: AppSettings): Promise<AppSettings> {
  const nextSettings: AppSettings = {
    asepritePath: settings.asepritePath.trim(),
    outputRoot: settings.outputRoot.trim()
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf8');

  return nextSettings;
}
