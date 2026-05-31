import sharp from 'sharp';
import { darkenHex, nearestHexColor, rgbToHex, type RgbaColor } from '../color';
import { parsePixelPlan } from '../schema';
import type { AgentProvider } from './agentProvider';
import type { DrawOp, PaletteColor, PixelPlan, PixelRequest } from '../types';

interface IndexedPixel {
  alpha: number;
  color: string | null;
}

export class DeterministicProvider implements AgentProvider {
  async analyze(request: PixelRequest): Promise<PixelPlan> {
    const image = await sharp(request.imagePath)
      .ensureAlpha()
      .resize(request.targetWidth, request.targetHeight, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        fit: 'contain',
        kernel: 'nearest',
        withoutEnlargement: false
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rawPixels = readRgbaPixels(image.data, request.targetWidth, request.targetHeight);
    const needsOutline = request.stylePreset !== 'portrait';
    const sourcePalette = extractPalette(rawPixels, Math.max(1, request.paletteMax - (needsOutline ? 1 : 0)));
    const outlineColor = needsOutline ? darkenHex(sourcePalette[0]?.hex ?? '#20242a', 0.42) : null;
    const palette = outlineColor
      ? [{ name: 'outline', hex: outlineColor }, ...sourcePalette].slice(0, request.paletteMax)
      : sourcePalette;
    const paletteColors = palette.map((color) => color.hex);
    const indexedPixels = indexPixels(rawPixels, paletteColors);
    const layers = needsOutline
      ? [
          { name: 'Outline', opacity: 1, visible: true },
          { name: 'Base', opacity: 1, visible: true }
        ]
      : [{ name: 'Base', opacity: 1, visible: true }];
    const drawOps: DrawOp[] = [];

    if (outlineColor) {
      drawOps.push({ op: 'layer', name: 'Outline' });
      drawOps.push(...buildOutlineRuns(indexedPixels, request.targetWidth, request.targetHeight, outlineColor));
    }

    drawOps.push({ op: 'layer', name: 'Base' });
    drawOps.push(...buildColorRuns(indexedPixels, request.targetWidth, request.targetHeight, 'Base'));

    return parsePixelPlan({
      canvas: {
        width: request.targetWidth,
        height: request.targetHeight,
        transparent: true
      },
      palette,
      layers,
      drawOps,
      artistNotes: [
        `Generated from ${request.stylePreset} preset at ${request.targetWidth}x${request.targetHeight}.`,
        `Palette reduced to ${palette.length} colors with nearest-color mapping.`,
        'Open the .aseprite file to refine silhouette, cluster cleanup, highlights, and readable details by hand.'
      ]
    });
  }

  async revise(request: PixelRequest, previousPlan: PixelPlan, feedback: string): Promise<PixelPlan> {
    return parsePixelPlan({
      ...previousPlan,
      artistNotes: [
        ...previousPlan.artistNotes.slice(0, 18),
        `Revision feedback captured for next provider: ${feedback.slice(0, 220)}`,
        `Requested output: ${request.outputName}`
      ]
    });
  }
}

function readRgbaPixels(data: Buffer, width: number, height: number): RgbaColor[] {
  const pixels: RgbaColor[] = [];
  const total = width * height;

  for (let pixelIndex = 0; pixelIndex < total; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    pixels.push({
      r: data[offset] ?? 0,
      g: data[offset + 1] ?? 0,
      b: data[offset + 2] ?? 0,
      a: data[offset + 3] ?? 0
    });
  }

  return pixels;
}

function extractPalette(pixels: RgbaColor[], maxColors: number): PaletteColor[] {
  const counts = new Map<string, { color: RgbaColor; count: number }>();

  for (const pixel of pixels) {
    if (pixel.a < 8) continue;

    const bucket = {
      r: Math.round(pixel.r / 16) * 16,
      g: Math.round(pixel.g / 16) * 16,
      b: Math.round(pixel.b / 16) * 16
    };
    const hex = rgbToHex(bucket).toLowerCase();
    const current = counts.get(hex);

    counts.set(hex, {
      color: { ...bucket, a: 255 },
      count: (current?.count ?? 0) + 1
    });
  }

  const ranked = [...counts.entries()]
    .sort(([, left], [, right]) => right.count - left.count)
    .slice(0, maxColors)
    .map(([hex], index) => ({
      name: `color-${String(index + 1).padStart(2, '0')}`,
      hex
    }));

  return ranked.length > 0 ? ranked : [{ name: 'color-01', hex: '#000000' }];
}

function indexPixels(pixels: RgbaColor[], palette: string[]): IndexedPixel[] {
  return pixels.map((pixel) => {
    if (pixel.a < 8) {
      return {
        alpha: pixel.a,
        color: null
      };
    }

    return {
      alpha: pixel.a,
      color: nearestHexColor(pixel, palette)
    };
  });
}

function buildColorRuns(pixels: IndexedPixel[], width: number, height: number, layer: string): DrawOp[] {
  const ops: DrawOp[] = [];

  for (let y = 0; y < height; y += 1) {
    let x = 0;

    while (x < width) {
      const pixel = pixels[y * width + x];

      if (!pixel?.color) {
        x += 1;
        continue;
      }

      const color = pixel.color;
      const startX = x;

      while (x < width && pixels[y * width + x]?.color === color) {
        x += 1;
      }

      ops.push({
        op: 'fillRect',
        layer,
        x: startX,
        y,
        width: x - startX,
        height: 1,
        color
      });
    }
  }

  return ops;
}

function buildOutlineRuns(pixels: IndexedPixel[], width: number, height: number, color: string): DrawOp[] {
  const outlinePixels = new Set<number>();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[y * width + x];
      if (!pixel?.color) continue;

      addOutlinePixel(outlinePixels, pixels, width, height, x - 1, y);
      addOutlinePixel(outlinePixels, pixels, width, height, x + 1, y);
      addOutlinePixel(outlinePixels, pixels, width, height, x, y - 1);
      addOutlinePixel(outlinePixels, pixels, width, height, x, y + 1);
    }
  }

  const ops: DrawOp[] = [];

  for (let y = 0; y < height; y += 1) {
    let x = 0;

    while (x < width) {
      const startX = x;

      while (x < width && !outlinePixels.has(y * width + x)) {
        x += 1;
      }

      if (x >= width) break;

      const runStart = x;
      while (x < width && outlinePixels.has(y * width + x)) {
        x += 1;
      }

      if (x > runStart) {
        ops.push({
          op: 'fillRect',
          layer: 'Outline',
          x: runStart,
          y,
          width: x - runStart,
          height: 1,
          color
        });
      } else {
        x = startX + 1;
      }
    }
  }

  return ops;
}

function addOutlinePixel(
  outlinePixels: Set<number>,
  pixels: IndexedPixel[],
  width: number,
  height: number,
  x: number,
  y: number
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = y * width + x;
  if (!pixels[index]?.color) {
    outlinePixels.add(index);
  }
}

