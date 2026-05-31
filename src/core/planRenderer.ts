import sharp from 'sharp';
import { hexToRgb } from './color';
import type { DrawOp, PixelPlan } from './types';

export async function renderPlanToPng(plan: PixelPlan, outputPath: string): Promise<void> {
  const width = plan.canvas.width;
  const height = plan.canvas.height;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const declaredLayers = new Set(plan.layers.map((layer) => layer.name));
  let currentLayer = plan.layers[0]?.name ?? 'Base';

  for (const op of plan.drawOps) {
    if (op.op === 'layer') {
      currentLayer = op.name;
      continue;
    }

    if (op.op === 'frame') {
      continue;
    }

    const layer = 'layer' in op && op.layer ? op.layer : currentLayer;
    if (!declaredLayers.has(layer)) continue;

    drawOp(pixels, width, height, op);
  }

  await sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toFile(outputPath);
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

