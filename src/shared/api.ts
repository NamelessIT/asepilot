import type { PipelineResult, PixelRequest, StylePreset } from '../core/types';

export interface AppSettings {
  asepritePath: string;
}

export interface PipelineResultView extends PipelineResult {
  previewPngUrl: string;
  referencePreviewUrl: string;
  asepritePngUrl: string | null;
}

export interface AsePilotApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  selectImage(): Promise<string | null>;
  selectAseprite(): Promise<string | null>;
  runPipeline(request: PixelRequest): Promise<PipelineResultView>;
  revealPath(path: string): Promise<void>;
}

export const stylePresetLabels: Record<StylePreset, string> = {
  'rpg-item': 'RPG item',
  'top-down-character': 'Top-down character',
  'platformer-sprite': 'Platformer sprite',
  icon: 'Icon',
  portrait: 'Portrait'
};

