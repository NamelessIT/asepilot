import { copyFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { rgbToHex, type RgbaColor } from './color';
import type { ProjectPaths } from './types';

export async function preprocessReferenceImage(sourcePath: string, paths: ProjectPaths): Promise<void> {
  await copyFile(sourcePath, paths.sourceImage);

  const metadata = await sharp(paths.sourceImage).metadata();

  await sharp(paths.sourceImage)
    .resize(512, 512, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .png()
    .toFile(paths.previewImage);

  const palette = await buildPaletteDraft(paths.sourceImage);
  await writeFile(
    paths.paletteDraft,
    JSON.stringify(
      {
        source: paths.sourceImage,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        format: metadata.format ?? null,
        palette
      },
      null,
      2
    ),
    'utf8'
  );
}

async function buildPaletteDraft(imagePath: string): Promise<Array<{ hex: string; count: number }>> {
  const resized = await sharp(imagePath)
    .ensureAlpha()
    .resize(64, 64, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  const pixelCount = resized.info.width * resized.info.height;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const pixel: RgbaColor = {
      r: resized.data[offset] ?? 0,
      g: resized.data[offset + 1] ?? 0,
      b: resized.data[offset + 2] ?? 0,
      a: resized.data[offset + 3] ?? 0
    };

    if (pixel.a < 8) continue;

    const hex = rgbToHex({
      r: Math.round(pixel.r / 16) * 16,
      g: Math.round(pixel.g / 16) * 16,
      b: Math.round(pixel.b / 16) * 16
    }).toLowerCase();

    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, 16)
    .map(([hex, count]) => ({ hex, count }));
}

