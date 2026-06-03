import sharp from 'sharp';
import { hexToRgb } from './color';
import type { DrawOp, PixelPlan } from './types';

export async function renderPlanToPng(plan: PixelPlan, outputPath: string): Promise<void> {
  const width = plan.canvas.width;
  const height = plan.canvas.height;
  const frameIndexes = collectFrameIndexes(plan);
  const framePixels = new Map<number, Uint8ClampedArray>();
  const declaredLayers = new Set(plan.layers.map((layer) => layer.name));
  const visibleLayers = new Set(plan.layers.filter((layer) => layer.visible !== false).map((layer) => layer.name));
  let currentLayer = plan.layers[0]?.name ?? 'Base';
  let currentFrame = frameIndexes[0] ?? 1;

  for (const op of plan.drawOps) {
    if (op.op === 'layer') {
      currentLayer = op.name;
      continue;
    }

    if (op.op === 'frame') {
      currentFrame = op.index;
      continue;
    }

    const layer = 'layer' in op && op.layer ? op.layer : currentLayer;
    if (!declaredLayers.has(layer) || !visibleLayers.has(layer)) continue;

    const pixels = framePixels.get(currentFrame) ?? new Uint8ClampedArray(width * height * 4);
    framePixels.set(currentFrame, pixels);
    drawOp(pixels, width, height, op);
  }

  const output = frameIndexes.length <= 1 ? (framePixels.get(frameIndexes[0] ?? 1) ?? new Uint8ClampedArray(width * height * 4)) : buildFrameStrip(frameIndexes, framePixels, width, height);
  const outputWidth = frameIndexes.length <= 1 ? width : width * frameIndexes.length;

  await sharp(Buffer.from(output), {
    raw: {
      width: outputWidth,
      height,
      channels: 4
    }
  })
    .png()
    .toFile(outputPath);
}

function collectFrameIndexes(plan: PixelPlan): number[] {
  const indexes = new Set<number>();

  for (const frame of plan.frames ?? []) {
    indexes.add(frame.index);
  }

  for (const op of plan.drawOps) {
    if (op.op === 'frame') {
      indexes.add(op.index);
    }
  }

  if (indexes.size === 0) indexes.add(1);

  return [...indexes].sort((left, right) => left - right);
}

function buildFrameStrip(
  frameIndexes: number[],
  framePixels: Map<number, Uint8ClampedArray>,
  width: number,
  height: number
): Uint8ClampedArray {
  const atlas = new Uint8ClampedArray(width * frameIndexes.length * height * 4);

  frameIndexes.forEach((frameIndex, frameOffset) => {
    const pixels = framePixels.get(frameIndex) ?? new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (y * width + x) * 4;
        const targetX = frameOffset * width + x;
        const targetOffset = (y * width * frameIndexes.length + targetX) * 4;

        atlas[targetOffset] = pixels[sourceOffset] ?? 0;
        atlas[targetOffset + 1] = pixels[sourceOffset + 1] ?? 0;
        atlas[targetOffset + 2] = pixels[sourceOffset + 2] ?? 0;
        atlas[targetOffset + 3] = pixels[sourceOffset + 3] ?? 0;
      }
    }
  });

  return atlas;
}

function drawOp(pixels: Uint8ClampedArray, width: number, height: number, op: Exclude<DrawOp, { op: 'layer' | 'frame' }>): void {
  switch (op.op) {
    case 'setPixel':
      setPixel(pixels, width, height, op.x, op.y, op.color);
      return;
    case 'fillRect':
      fillRect(pixels, width, height, op.x, op.y, op.width, op.height, op.color);
      return;
    case 'rect':
      drawRect(pixels, width, height, op.x, op.y, op.width, op.height, op.color);
      return;
    case 'line':
      drawLine(pixels, width, height, op.x1, op.y1, op.x2, op.y2, op.color);
      return;
    case 'ellipse':
      drawEllipse(pixels, width, height, op.x, op.y, op.width, op.height, op.color, op.fill ?? false);
      return;
  }
}

function setPixel(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const color = hexToRgb(hex);
  const offset = (y * width + x) * 4;
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = color.a;
}

function fillRect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  hex: string
): void {
  for (let yy = y; yy < y + rectHeight; yy += 1) {
    for (let xx = x; xx < x + rectWidth; xx += 1) {
      setPixel(pixels, width, height, xx, yy, hex);
    }
  }
}

function drawRect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  hex: string
): void {
  fillRect(pixels, width, height, x, y, rectWidth, 1, hex);
  fillRect(pixels, width, height, x, y + rectHeight - 1, rectWidth, 1, hex);
  fillRect(pixels, width, height, x, y, 1, rectHeight, hex);
  fillRect(pixels, width, height, x + rectWidth - 1, y, 1, rectHeight, hex);
}

function drawLine(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  hex: string
): void {
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const dy = -Math.abs(y2 - y1);
  const stepX = x1 < x2 ? 1 : -1;
  const stepY = y1 < y2 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    setPixel(pixels, width, height, x, y, hex);
    if (x === x2 && y === y2) break;

    const error2 = 2 * error;
    if (error2 >= dy) {
      error += dy;
      x += stepX;
    }
    if (error2 <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

function drawEllipse(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  ellipseWidth: number,
  ellipseHeight: number,
  hex: string,
  fill: boolean
): void {
  const rx = Math.max(ellipseWidth / 2, 0.5);
  const ry = Math.max(ellipseHeight / 2, 0.5);
  const cx = x + rx - 0.5;
  const cy = y + ry - 0.5;

  for (let yy = y; yy < y + ellipseHeight; yy += 1) {
    for (let xx = x; xx < x + ellipseWidth; xx += 1) {
      const normalized = ((xx - cx) ** 2) / (rx ** 2) + ((yy - cy) ** 2) / (ry ** 2);
      if (fill ? normalized <= 1 : normalized > 0.72 && normalized <= 1.12) {
        setPixel(pixels, width, height, xx, yy, hex);
      }
    }
  }
}
