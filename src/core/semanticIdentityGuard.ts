import sharp from 'sharp';
import { hexToRgb, rgbToHex } from './color';
import type { PixelPlan, PixelRequest } from './types';

export async function assertSemanticIdentityMatchesReference(
  request: PixelRequest,
  referenceImagePath: string,
  plan: PixelPlan
): Promise<void> {
  if (!requiresSemanticTopdown(request)) return;

  const referencePalette = await extractReferencePalette(referenceImagePath, request.targetWidth, request.targetHeight);
  if (referencePalette.length === 0) return;

  const alienColors = plan.palette
    .map((color) => color.hex.toLowerCase())
    .filter((hex) => nearestColorDistance(hex, referencePalette) > 7_200);
  const allowedAlienColors = Math.max(2, Math.floor(plan.palette.length * 0.35));

  if (alienColors.length > allowedAlienColors) {
    throw new Error(
      [
        'AI output failed reference identity check.',
        `Generated palette drifted too far from the reference. Off-reference colors: ${alienColors.slice(0, 8).join(', ')}.`,
        'Retry with a stronger model/API provider, or choose a non-semantic local mode if a geometric fallback is acceptable.'
      ].join(' ')
    );
  }
}

function requiresSemanticTopdown(request: Pick<PixelRequest, 'animationMode' | 'stylePreset'>): boolean {
  return (
    request.stylePreset === 'top-down-character' &&
    (request.animationMode === 'topdown-4dir' || request.animationMode === 'topdown-walk-8')
  );
}

async function extractReferencePalette(imagePath: string, width: number, height: number): Promise<string[]> {
  const image = await sharp(imagePath)
    .ensureAlpha()
    .resize(width, height, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: 'contain',
      kernel: 'nearest'
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  const totalPixels = image.info.width * image.info.height;

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    const alpha = image.data[offset + 3] ?? 0;
    if (alpha < 8) continue;

    const hex = rgbToHex({
      r: Math.round((image.data[offset] ?? 0) / 8) * 8,
      g: Math.round((image.data[offset + 1] ?? 0) / 8) * 8,
      b: Math.round((image.data[offset + 2] ?? 0) / 8) * 8
    }).toLowerCase();

    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, 16)
    .map(([hex]) => hex);
}

function nearestColorDistance(hex: string, palette: string[]): number {
  return palette.reduce((best, candidate) => Math.min(best, colorDistance(hex, candidate)), Number.POSITIVE_INFINITY);
}

function colorDistance(leftHex: string, rightHex: string): number {
  const left = hexToRgb(leftHex);
  const right = hexToRgb(rightHex);

  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}
