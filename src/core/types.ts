export const STYLE_PRESETS = [
  'rpg-item',
  'top-down-character',
  'platformer-sprite',
  'icon',
  'portrait'
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number];

export interface PixelRequest {
  imagePath: string;
  targetWidth: number;
  targetHeight: number;
  paletteMax: number;
  stylePreset: StylePreset;
  outputName: string;
}

export interface PaletteColor {
  name: string;
  hex: string;
}

export interface PixelLayer {
  name: string;
  opacity?: number;
  visible?: boolean;
}

interface DrawOpBase {
  layer?: string;
}

export interface LayerDrawOp {
  op: 'layer';
  name: string;
}

export interface FrameDrawOp {
  op: 'frame';
  index: number;
}

export interface SetPixelDrawOp extends DrawOpBase {
  op: 'setPixel';
  x: number;
  y: number;
  color: string;
}

export interface FillRectDrawOp extends DrawOpBase {
  op: 'fillRect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface RectDrawOp extends DrawOpBase {
  op: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface LineDrawOp extends DrawOpBase {
  op: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface EllipseDrawOp extends DrawOpBase {
  op: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fill?: boolean;
}

export type DrawOp =
  | LayerDrawOp
  | FrameDrawOp
  | SetPixelDrawOp
  | FillRectDrawOp
  | RectDrawOp
  | LineDrawOp
  | EllipseDrawOp;

export interface PixelPlan {
  canvas: {
    width: number;
    height: number;
    transparent: boolean;
  };
  palette: PaletteColor[];
  layers: PixelLayer[];
  drawOps: DrawOp[];
  artistNotes: string[];
}

export interface ProjectPaths {
  projectId: string;
  root: string;
  inputDir: string;
  analysisDir: string;
  plansDir: string;
  scriptsDir: string;
  exportsDir: string;
  sourceImage: string;
  previewImage: string;
  paletteDraft: string;
  pixelPlan: string;
  luaScript: string;
  fallbackPng: string;
  asepriteFile: string;
  asepritePng: string;
}

export interface AsepriteRunResult {
  status: 'skipped' | 'success' | 'failed';
  command?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface PipelineResult {
  projectId: string;
  projectRoot: string;
  sourceImage: string;
  previewImage: string;
  paletteDraft: string;
  pixelPlan: string;
  luaScript: string;
  previewPng: string;
  asepriteFile: string;
  asepritePng: string;
  aseprite: AsepriteRunResult;
  plan: PixelPlan;
}

