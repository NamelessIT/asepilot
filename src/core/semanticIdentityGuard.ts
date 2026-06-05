import sharp from 'sharp';
import { hexToRgb, rgbToHex, type RgbaColor } from './color';
import type { PixelPlan, PixelRequest } from './types';

export interface ReferenceIdentityPalette {
  all: string[];
  background: string[];
  subject: string[];
  subjectAccents: string[];
}

export async function assertSemanticIdentityMatchesReference(
  request: PixelRequest,
  referenceImagePath: string,
  plan: PixelPlan
): Promise<void> {
  if (!requiresSemanticTopdown(request)) return;

  const referencePalette = await extractReferenceIdentityPalette(referenceImagePath, request.targetWidth, request.targetHeight);
  if (referencePalette.all.length === 0) return;
  const generatedDrawColors = collectGeneratedDrawColors(plan);

  const alienColors = plan.palette
    .map((color) => color.hex.toLowerCase())
    .filter((hex) => nearestColorDistance(hex, referencePalette.all) > 7_200);
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

  const vividSubjectAccents = referencePalette.subjectAccents.filter((hex) => saturation(hex) > 48);
  const hasVividAccent = vividSubjectAccents.some((hex) => nearestColorDistance(hex, generatedDrawColors) <= 5_200);

  if (vividSubjectAccents.length > 0 && !hasVividAccent) {
    throw new Error(
      [
        'AI output failed reference identity check.',
        `Generated sprite is missing vivid subject accent colors from the reference: ${vividSubjectAccents.slice(0, 6).join(', ')}.`,
        `Background colors are ${referencePalette.background.slice(0, 5).join(', ')} and should not replace the creature body/accent palette.`,
        'Retry with a stronger model/API provider, or choose a non-semantic local mode if a geometric fallback is acceptable.'
      ].join(' ')
    );
  }

  const missingAccents = referencePalette.subjectAccents.filter((hex) => nearestColorDistance(hex, generatedDrawColors) > 5_200);
  const allowedMissingAccents = Math.max(0, referencePalette.subjectAccents.length - 1);

  if (referencePalette.subjectAccents.length > 0 && missingAccents.length > allowedMissingAccents) {
    throw new Error(
      [
        'AI output failed reference identity check.',
        `Generated sprite is missing distinctive subject colors from the reference: ${missingAccents.slice(0, 6).join(', ')}.`,
        `Background colors are ${referencePalette.background.slice(0, 5).join(', ')} and should not replace the creature body/accent palette.`,
        'Retry with a stronger model/API provider, or choose a non-semantic local mode if a geometric fallback is acceptable.'
      ].join(' ')
    );
  }
}

function requiresSemanticTopdown(request: Pick<PixelRequest, 'animationMode' | 'stylePreset'>): boolean {
  return (
    request.stylePreset === 'top-down-character' &&
    ['topdown-4dir', 'topdown-walk-8', 'topdown-idle-4dir', 'topdown-rpg-full-4dir'].includes(request.animationMode)
  );
}

export async function extractReferenceIdentityPalette(imagePath: string, width: number, height: number): Promise<ReferenceIdentityPalette> {
  const image = await sharp(imagePath)
    .ensureAlpha()
    .resize(width, height, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: 'contain',
      kernel: 'nearest'
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const allCounts = new Map<string, number>();
  const backgroundCounts = new Map<string, number>();
  const subjectCounts = new Map<string, number>();
  const backgroundSamples = collectBackgroundSamples(image.data, image.info.width, image.info.height);
  const totalPixels = image.info.width * image.info.height;

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    const color = readPixel(image.data, offset);
    if (!color || color.a < 8) continue;

    const hex = quantizedHex(color);
    allCounts.set(hex, (allCounts.get(hex) ?? 0) + 1);

    if (nearestRgbDistance(color, backgroundSamples) <= 1_400) {
      backgroundCounts.set(hex, (backgroundCounts.get(hex) ?? 0) + 1);
    } else {
      subjectCounts.set(hex, (subjectCounts.get(hex) ?? 0) + 1);
    }
  }

  const all = topColors(allCounts, 16);
  const background = topColors(backgroundCounts, 8);
  const subject = topColors(subjectCounts.size > 0 ? subjectCounts : allCounts, 12);
  const vividAccents = rankedAccentColors(subjectCounts.size > 0 ? subjectCounts : allCounts, background, 5);
  const subjectAccents = uniqueColors([
    ...vividAccents,
    ...subject.filter((hex) => backgroundDistance(hex, background) > 4_800 || saturation(hex) > 48)
  ]).slice(0, 5);

  return {
    all,
    background,
    subject,
    subjectAccents
  };
}

function collectGeneratedDrawColors(plan: PixelPlan): string[] {
  return [
    ...new Set(
      plan.drawOps.flatMap((op) => {
        if ('color' in op) return [op.color.toLowerCase()];
        return [];
      })
    )
  ];
}

function collectBackgroundSamples(data: Buffer, width: number, height: number): RgbaColor[] {
  const samples: RgbaColor[] = [];

  for (let x = 0; x < width; x += 1) {
    pushPixel(samples, data, x, 0, width);
    pushPixel(samples, data, x, height - 1, width);
  }

  for (let y = 0; y < height; y += 1) {
    pushPixel(samples, data, 0, y, width);
    pushPixel(samples, data, width - 1, y, width);
  }

  return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0, a: 255 }];
}

function pushPixel(samples: RgbaColor[], data: Buffer, x: number, y: number, width: number): void {
  const pixel = readPixel(data, (y * width + x) * 4);
  if (pixel && pixel.a >= 8) samples.push(pixel);
}

function readPixel(data: Buffer, offset: number): RgbaColor | null {
  return {
    r: data[offset] ?? 0,
    g: data[offset + 1] ?? 0,
    b: data[offset + 2] ?? 0,
    a: data[offset + 3] ?? 0
  };
}

function quantizedHex(color: RgbaColor): string {
  return rgbToHex({
    r: Math.round(color.r / 8) * 8,
    g: Math.round(color.g / 8) * 8,
    b: Math.round(color.b / 8) * 8
  }).toLowerCase();
}

function topColors(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit)
    .map(([hex]) => hex);
}

function rankedAccentColors(counts: Map<string, number>, background: string[], limit: number): string[] {
  return [...counts.entries()]
    .filter(([hex, count]) => count >= 2 && (saturation(hex) >= 56 || backgroundDistance(hex, background) >= 5_200))
    .sort(([leftHex, leftCount], [rightHex, rightCount]) => {
      const leftScore = accentScore(leftHex, leftCount, background);
      const rightScore = accentScore(rightHex, rightCount, background);

      return rightScore - leftScore;
    })
    .slice(0, limit)
    .map(([hex]) => hex);
}

function accentScore(hex: string, count: number, background: string[]): number {
  return saturation(hex) * 8 + Math.sqrt(count) * 12 + Math.min(120, backgroundDistance(hex, background) / 120);
}

function uniqueColors(colors: string[]): string[] {
  return [...new Set(colors.map((color) => color.toLowerCase()))];
}

function nearestRgbDistance(color: RgbaColor, samples: RgbaColor[]): number {
  return samples.reduce((best, sample) => Math.min(best, rgbDistance(color, sample)), Number.POSITIVE_INFINITY);
}

function rgbDistance(left: RgbaColor, right: RgbaColor): number {
  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}

function nearestColorDistance(hex: string, palette: string[]): number {
  return palette.reduce((best, candidate) => Math.min(best, colorDistance(hex, candidate)), Number.POSITIVE_INFINITY);
}

function backgroundDistance(hex: string, background: string[]): number {
  return background.length > 0 ? nearestColorDistance(hex, background) : 0;
}

function colorDistance(leftHex: string, rightHex: string): number {
  const left = hexToRgb(leftHex);
  const right = hexToRgb(rightHex);

  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}

function saturation(hex: string): number {
  const color = hexToRgb(hex);
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);

  return max - min;
}
