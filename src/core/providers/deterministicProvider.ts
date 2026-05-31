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
        kernel: 'lanczos3',
        withoutEnlargement: false
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rawPixels = readRgbaPixels(image.data, request.targetWidth, request.targetHeight);
    const needsOutline = request.stylePreset !== 'portrait';
    const sourcePalette = extractPalette(rawPixels, Math.max(1, request.paletteMax - (needsOutline ? 1 : 0)));
    const outlineColor = needsOutline ? pickOutlineColor(sourcePalette) : null;
    const palette = buildFinalPalette(sourcePalette, outlineColor, request.paletteMax);
    const paletteColors = palette.map((color) => color.hex);
    const indexedPixels = denoiseIndexedPixels(indexPixels(rawPixels, paletteColors), request.targetWidth, request.targetHeight);
    const layers = needsOutline
      ? [
          { name: 'Base', opacity: 1, visible: true },
          { name: 'Outline', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ]
      : [
          { name: 'Base', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ];
    const drawOps: DrawOp[] = [];

    drawOps.push({ op: 'layer', name: 'Base' });
    drawOps.push(...buildColorRuns(indexedPixels, request.targetWidth, request.targetHeight, 'Base'));

    if (outlineColor) {
      drawOps.push({ op: 'layer', name: 'Outline' });
      drawOps.push(...buildOutlineRuns(indexedPixels, request.targetWidth, request.targetHeight, outlineColor));
    }

    drawOps.push({ op: 'layer', name: 'Edits' });

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
        `Generated from ${request.stylePreset} preset at ${request.targetWidth}x${request.targetHeight} using local quantization.`,
        `Palette reduced to ${palette.length} unique colors with weighted k-means and nearest-color mapping.`,
        'Generated pixels are on Base, outline pixels are on Outline, and the empty Edits layer is selected for immediate paint-over edits.',
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
  const samples = buildWeightedSamples(pixels);

  if (samples.length === 0) {
    return [{ name: 'color-01', hex: '#000000' }];
  }

  const targetColorCount = Math.max(1, Math.min(maxColors, samples.length));
  const centroids = seedCentroids(samples, targetColorCount);

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const totals = centroids.map(() => ({
      r: 0,
      g: 0,
      b: 0,
      weight: 0
    }));

    for (const sample of samples) {
      const index = findNearestColorIndex(sample.color, centroids);
      const total = totals[index];
      if (!total) continue;

      total.r += sample.color.r * sample.weight;
      total.g += sample.color.g * sample.weight;
      total.b += sample.color.b * sample.weight;
      total.weight += sample.weight;
    }

    totals.forEach((total, index) => {
      if (total.weight <= 0) return;

      centroids[index] = {
        r: total.r / total.weight,
        g: total.g / total.weight,
        b: total.b / total.weight,
        a: 255
      };
    });
  }

  const centroidColors = centroids.map((color) => rgbToHex(color).toLowerCase());
  const fallbackColors = samples.map((sample) => rgbToHex(sample.color).toLowerCase());
  const uniqueColors = uniqueHexColors([...centroidColors, ...fallbackColors]).slice(0, targetColorCount);

  return uniqueColors.map((hex, index) => ({
      name: `color-${String(index + 1).padStart(2, '0')}`,
      hex
    }));
}

function buildWeightedSamples(pixels: RgbaColor[]): Array<{ color: RgbaColor; weight: number }> {
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number }>();

  for (const pixel of pixels) {
    if (pixel.a < 16) continue;

    const key = `${Math.floor(pixel.r / 12)}:${Math.floor(pixel.g / 12)}:${Math.floor(pixel.b / 12)}`;
    const current = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    const alphaWeight = pixel.a / 255;

    current.r += pixel.r * alphaWeight;
    current.g += pixel.g * alphaWeight;
    current.b += pixel.b * alphaWeight;
    current.weight += alphaWeight;
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.weight > 0)
    .map((bucket) => ({
      color: {
        r: bucket.r / bucket.weight,
        g: bucket.g / bucket.weight,
        b: bucket.b / bucket.weight,
        a: 255
      },
      weight: bucket.weight
    }))
    .sort((left, right) => right.weight - left.weight);
}

function seedCentroids(samples: Array<{ color: RgbaColor; weight: number }>, count: number): RgbaColor[] {
  const centroids: RgbaColor[] = [samples[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }];

  while (centroids.length < count) {
    let bestSample = samples[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const sample of samples) {
      const nearestColor = centroids[findNearestColorIndex(sample.color, centroids)] ?? centroids[0] ?? sample.color;
      const nearestDistance = colorDistance(sample.color, nearestColor);
      const score = nearestDistance * Math.sqrt(sample.weight);

      if (score > bestScore) {
        bestSample = sample;
        bestScore = score;
      }
    }

    if (!bestSample) break;
    centroids.push(bestSample.color);
  }

  return centroids;
}

function findNearestColorIndex(color: RgbaColor, colors: RgbaColor[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  colors.forEach((candidate, index) => {
    const distance = colorDistance(color, candidate);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function colorDistance(left: RgbaColor, right: RgbaColor): number {
  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}

function pickOutlineColor(sourcePalette: PaletteColor[]): string {
  const paletteHexes = sourcePalette.map((color) => color.hex);
  const darkest = [...sourcePalette].sort((left, right) => luminance(left.hex) - luminance(right.hex))[0]?.hex ?? '#20242a';
  const candidates = [darkenHex(darkest, 0.45), darkenHex(darkest, 0.3), '#101820', '#17212b', '#05070a'];

  return candidates.find((candidate) => !paletteHexes.includes(candidate)) ?? candidates[0] ?? '#101820';
}

function buildFinalPalette(sourcePalette: PaletteColor[], outlineColor: string | null, paletteMax: number): PaletteColor[] {
  const colors = outlineColor ? [{ name: 'outline', hex: outlineColor }, ...sourcePalette] : sourcePalette;
  const seen = new Set<string>();
  const uniquePalette: PaletteColor[] = [];

  for (const color of colors) {
    const hex = color.hex.toLowerCase();
    if (seen.has(hex)) continue;

    seen.add(hex);
    uniquePalette.push({
      ...color,
      hex
    });
  }

  return uniquePalette.slice(0, paletteMax);
}

function uniqueHexColors(colors: string[]): string[] {
  return [...new Set(colors.map((color) => color.toLowerCase()))];
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

function denoiseIndexedPixels(pixels: IndexedPixel[], width: number, height: number): IndexedPixel[] {
  if (width < 16 || height < 16) return pixels;

  return pixels.map((pixel, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const neighborColors = collectNeighborColors(pixels, width, height, x, y);

    if (!pixel.color && neighborColors.length >= 5) {
      return {
        alpha: 255,
        color: mostCommonColor(neighborColors)
      };
    }

    if (pixel.color && neighborColors.length <= 1) {
      return {
        alpha: 0,
        color: null
      };
    }

    return pixel;
  });
}

function collectNeighborColors(pixels: IndexedPixel[], width: number, height: number, x: number, y: number): string[] {
  const colors: string[] = [];

  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      if (xx === x && yy === y) continue;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;

      const color = pixels[yy * width + xx]?.color;
      if (color) colors.push(color);
    }
  }

  return colors;
}

function mostCommonColor(colors: string[]): string {
  const counts = new Map<string, number>();

  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  return [...counts.entries()].sort(([, left], [, right]) => right - left)[0]?.[0] ?? colors[0] ?? '#000000';
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
