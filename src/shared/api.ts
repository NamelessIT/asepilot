import type { AgentProviderId, AnimationMode, PipelineResult, PixelRequest, SegmentationMode, StylePreset } from '../core/types';

export interface AppSettings {
  agentProvider: AgentProviderId;
  asepritePath: string;
  cliCommand: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  outputRoot: string;
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
  selectOutputFolder(): Promise<string | null>;
  runPipeline(request: PixelRequest): Promise<PipelineResultView>;
  revealPath(path: string): Promise<void>;
}

export const stylePresetLabels: Record<StylePreset, string> = {
  'rpg-item': 'RPG item',
  'top-down-character': 'Top-down character',
  'platformer-sprite': 'Platformer sprite',
  'side-view-character': 'Side-view character',
  'isometric-prop': 'Isometric prop',
  'tileset-prop': 'Tileset prop',
  icon: 'Icon',
  portrait: 'Portrait'
};

export const animationModeLabels: Record<AnimationMode, string> = {
  single: 'Single frame',
  'idle-4frame': 'Idle - 4 frames',
  'topdown-4dir': 'Top-down 4 huong - AI semantic',
  'topdown-walk-8': 'Top-down walk - AI semantic',
  'item-shine-4frame': 'Item shine - 4 frames'
};

export const segmentationModeLabels: Record<SegmentationMode, string> = {
  none: 'Khong tach',
  'auto-local': 'Tach nen/nhan vat',
  'center-subject': 'Chi lay nhan vat o giua',
  'ai-model': 'AI semantic'
};

export const agentProviderLabels: Record<AgentProviderId, string> = {
  local: 'Local deterministic',
  'openai-compatible': 'OpenAI-compatible API',
  'cli-json': 'CLI JSON agent'
};
