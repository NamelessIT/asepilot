import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ZodError } from 'zod';
import { parsePixelPlan } from '../schema';
import type { PixelPlan, PixelRequest } from '../types';

export function buildPixelPlanPrompt(request: PixelRequest, extra?: string): string {
  const drawOpBudget = estimateDrawOpBudget(request);
  const semanticTopdownInstructions = requiresSemanticTopdown(request)
    ? [
        'Semantic top-down turnaround requirement:',
        '- Treat the reference as the DOWN-facing/front-facing sprite only.',
        '- Infer and redraw LEFT, RIGHT, and UP/back views as a game sprite artist would.',
        '- Do not create direction frames by rotating, mirroring, shifting, or copying the down frame.',
        '- LEFT and RIGHT must be profile/side views with the subject facing horizontally.',
        '- UP must show the back view; hide or reduce front-facing facial/eye/mouth details that would not be visible from behind.',
        '- Preserve identity: silhouette language, colors, horns/antennae/ears/weapons, scale, and material clusters should remain recognizable.',
        '- Keep each frame centered, same canvas size, same palette, and consistent feet/contact shadow position.',
        '- Use frame labels exactly Down, Left, Right, Up for topdown-4dir.',
        '- For topdown-walk-8, use labels Down Walk 1, Down Walk 2, Left Walk 1, Left Walk 2, Right Walk 1, Right Walk 2, Up Walk 1, Up Walk 2.',
        '- If the source is an animal, monster, bug, or creature, redraw anatomy per direction rather than rotating the entire body.',
        '- Keep the plan compact: draw a readable sprite using clustered primitives, not exhaustive per-pixel raster data.',
        `- Hard budget: keep total drawOps under ${drawOpBudget}. Use fillRect/rect/line/ellipse for clusters and outlines.`
      ]
    : [];

  return [
    'This is an image-to-pixel-art planning task, not a software engineering task.',
    'Do not inspect the repository. Do not run shell commands. Do not call tools. Use only the attached/reference image and these instructions.',
    'Return exactly one JSON object. Do not return markdown, comments, Lua, JavaScript, or prose.',
    'The JSON object must match the AsePilot PixelPlan contract.',
    `Canvas must be exactly ${request.targetWidth}x${request.targetHeight}.`,
    `Style preset: ${request.stylePreset}.`,
    `Segmentation mode: ${request.segmentationMode}.`,
    `Animation mode: ${request.animationMode}.`,
    `Maximum palette colors: ${request.paletteMax}.`,
    'Required top-level fields: canvas, palette, layers, frames, animations, drawOps, artistNotes.',
    'canvas: { width, height, transparent }.',
    'palette: array of { name, hex }. Use unique #rrggbb colors only.',
    'layers: array of { name, opacity, visible }. Layer names must be unique.',
    'frames: array of { index, durationMs, label }. Use frame index starting at 1.',
    'animations: array of { name, from, to, direction? }.',
    `drawOps must be compact. Prefer fillRect runs over thousands of setPixel ops. Target total drawOps <= ${drawOpBudget}.`,
    'Allowed drawOps only: layer, frame, setPixel, rect, line, fillRect, ellipse.',
    'For rect, fillRect, and ellipse, use x, y, width, height. Do not use x1, y1, x2, y2, w, or h for these ops.',
    'For line only, use x1, y1, x2, y2.',
    'Every draw op color must appear in palette. Every draw op layer must appear in layers.',
    'Coordinates must stay inside the canvas. Canvas size must not exceed 256x256.',
    'Use editable layers such as Background, Character Base, Outline, Effects, Shadow, Edits when useful.',
    'Preserve the reference identity and art style. Do not invent a different character, mascot, icon, or cartoon redesign.',
    'If the reference is already pixel art, keep the same chunky pixel cluster language, proportions, silhouette, and hue family.',
    'If animationMode is topdown-4dir, create frames for down, left, right, up.',
    'If animationMode is topdown-walk-8, create eight frames: down1, down2, left1, left2, right1, right2, up1, up2.',
    ...semanticTopdownInstructions,
    'For top-down characters, simplify the source into a readable sprite instead of just shrinking the image.',
    'For item/icon styles, separate the object from glow/background when possible.',
    extra ? `Additional instruction: ${extra}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function requiresSemanticTopdown(request: Pick<PixelRequest, 'animationMode' | 'stylePreset'>): boolean {
  return (
    request.stylePreset === 'top-down-character' &&
    (request.animationMode === 'topdown-4dir' || request.animationMode === 'topdown-walk-8')
  );
}

function estimateDrawOpBudget(request: Pick<PixelRequest, 'animationMode' | 'stylePreset' | 'targetWidth' | 'targetHeight'>): number {
  if (!requiresSemanticTopdown(request)) {
    return Math.max(350, Math.min(2400, Math.round((request.targetWidth * request.targetHeight) / 6)));
  }

  const frameCount = request.animationMode === 'topdown-walk-8' ? 8 : 4;
  const frameArea = request.targetWidth * request.targetHeight;
  const perFrameBudget = frameArea <= 4096 ? 170 : frameArea <= 16384 ? 280 : 420;

  return frameCount * perFrameBudget;
}

export async function imageToDataUrl(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const mimeType = imageMimeType(filePath);

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export function parseAgentPlanOutput(output: string): PixelPlan {
  const value = JSON.parse(extractJsonObject(output)) as unknown;

  try {
    return parsePixelPlan(normalizeAgentPlan(value));
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Agent PixelPlan validation failed: ${formatZodIssues(error)}`);
    }

    throw error;
  }
}

function normalizeAgentPlan(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const plan: Record<string, unknown> = { ...value };

  if (Array.isArray(plan.palette)) {
    plan.palette = normalizePalette(plan.palette);
  }

  if (Array.isArray(plan.layers)) {
    plan.layers = normalizeLayers(plan.layers);
  }

  if (Array.isArray(plan.drawOps)) {
    plan.drawOps = plan.drawOps.map((op) => normalizeDrawOp(op));
  }

  if (!Array.isArray(plan.artistNotes)) {
    plan.artistNotes = ['Generated by agent.'];
  }

  return plan;
}

function normalizePalette(value: unknown[]): unknown[] {
  const seen = new Set<string>();
  const palette: unknown[] = [];

  value.forEach((entry, index) => {
    const color = typeof entry === 'string' ? { name: `color-${String(index + 1).padStart(2, '0')}`, hex: entry } : entry;
    if (!isRecord(color)) {
      palette.push(entry);
      return;
    }

    const hex = typeof color.hex === 'string' ? normalizeHex(color.hex) : color.hex;
    if (typeof hex === 'string') {
      const key = hex.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
    }

    palette.push({
      ...color,
      hex
    });
  });

  return palette;
}

function normalizeLayers(value: unknown[]): unknown[] {
  const seen = new Set<string>();
  const layers: unknown[] = [];

  for (const entry of value) {
    const layer = typeof entry === 'string' ? { name: entry } : entry;
    if (!isRecord(layer)) {
      layers.push(entry);
      continue;
    }

    const name = typeof layer.name === 'string' ? layer.name.trim() : undefined;
    if (name) {
      if (seen.has(name)) continue;
      seen.add(name);
    }

    layers.push({
      ...layer,
      ...(name ? { name } : {}),
      ...normalizeLayerOpacity(layer.opacity),
      ...normalizeLayerVisibility(layer.visible)
    });
  }

  return layers;
}

function normalizeLayerOpacity(value: unknown): { opacity?: number } {
  const opacity = numericValue(value);
  if (opacity === undefined) return {};

  if (opacity <= 1) {
    return {
      opacity: Math.max(0, opacity)
    };
  }

  if (opacity <= 100) {
    return {
      opacity: Math.max(0, Math.min(1, opacity / 100))
    };
  }

  return {
    opacity: Math.max(0, Math.min(1, opacity / 255))
  };
}

function normalizeLayerVisibility(value: unknown): { visible?: boolean } {
  if (typeof value === 'boolean') return { visible: value };
  if (typeof value === 'number') return { visible: value !== 0 };
  if (typeof value !== 'string') return {};

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'visible', '1'].includes(normalized)) return { visible: true };
  if (['false', 'no', 'hidden', '0'].includes(normalized)) return { visible: false };

  return {};
}

function normalizeDrawOp(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const opName = normalizeOpName(value.op);
  const op: Record<string, unknown> = {
    ...value,
    op: opName
  };

  if (typeof op.color === 'string') {
    op.color = normalizeHex(op.color);
  }

  switch (opName) {
    case 'layer':
      if (typeof op.name !== 'string' && typeof op.layer === 'string') {
        op.name = op.layer;
      }
      return op;
    case 'frame':
      op.index = firstNumber(op, ['index', 'frame', 'frameIndex']) ?? op.index;
      return op;
    case 'setPixel':
      op.x = firstNumber(op, ['x', 'x1', 'left']) ?? op.x;
      op.y = firstNumber(op, ['y', 'y1', 'top']) ?? op.y;
      return roundNumericFields(op, ['x', 'y']);
    case 'fillRect':
    case 'rect':
    case 'ellipse':
      return normalizeBoxDrawOp(op, opName);
    case 'line':
      op.x1 = firstNumber(op, ['x1', 'x', 'left']) ?? op.x1;
      op.y1 = firstNumber(op, ['y1', 'y', 'top']) ?? op.y1;
      op.x2 = firstNumber(op, ['x2', 'endX', 'right']) ?? op.x2;
      op.y2 = firstNumber(op, ['y2', 'endY', 'bottom']) ?? op.y2;
      return roundNumericFields(op, ['x1', 'y1', 'x2', 'y2']);
    default:
      return value;
  }
}

function normalizeBoxDrawOp(op: Record<string, unknown>, opName: string): Record<string, unknown> {
  let x = firstNumber(op, ['x', 'left', 'x1']);
  let y = firstNumber(op, ['y', 'top', 'y1']);
  let width = firstNumber(op, ['width', 'w']);
  let height = firstNumber(op, ['height', 'h']);
  const x2 = firstNumber(op, ['x2', 'endX', 'right']);
  const y2 = firstNumber(op, ['y2', 'endY', 'bottom']);

  if (x === undefined && opName === 'ellipse') {
    const centerX = firstNumber(op, ['cx', 'centerX']);
    const radiusX = firstNumber(op, ['rx', 'radiusX', 'radius', 'r']);
    if (centerX !== undefined && radiusX !== undefined) {
      width = width ?? radiusX * 2;
      x = centerX - (width ?? 1) / 2;
    }
  }

  if (y === undefined && opName === 'ellipse') {
    const centerY = firstNumber(op, ['cy', 'centerY']);
    const radiusY = firstNumber(op, ['ry', 'radiusY', 'radius', 'r']);
    if (centerY !== undefined && radiusY !== undefined) {
      height = height ?? radiusY * 2;
      y = centerY - (height ?? 1) / 2;
    }
  }

  if (x !== undefined && x2 !== undefined) {
    const left = Math.min(x, x2);
    width = width ?? Math.abs(x2 - x) + 1;
    x = left;
  }

  if (y !== undefined && y2 !== undefined) {
    const top = Math.min(y, y2);
    height = height ?? Math.abs(y2 - y) + 1;
    y = top;
  }

  op.x = x ?? op.x;
  op.y = y ?? op.y;
  op.width = width ?? op.width;
  op.height = height ?? op.height;

  return roundNumericFields(op, ['x', 'y', 'width', 'height']);
}

function normalizeOpName(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.replace(/[\s_-]/g, '').toLowerCase();
  const aliases: Record<string, string> = {
    box: 'rect',
    fillrectangle: 'fillRect',
    filledrect: 'fillRect',
    filledrectangle: 'fillRect',
    fillrect: 'fillRect',
    pixel: 'setPixel',
    point: 'setPixel',
    rectangle: 'rect',
    setpixel: 'setPixel'
  };

  return aliases[normalized] ?? value;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numericValue(record[key]);
    if (value !== undefined) return value;
  }

  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function roundNumericFields(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      record[key] = Math.round(value);
    }
  }

  return record;
}

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();

  return value;
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonObject(output: string): string {
  const trimmed = output.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith('{')) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  if (start >= 0) {
    for (const candidate of extractBalancedObjects(trimmed)) {
      if (candidate.includes('"canvas"') && candidate.includes('"palette"') && candidate.includes('"layers"') && candidate.includes('"drawOps"')) {
        return candidate;
      }
    }
  }

  throw new Error('Agent did not return a JSON object.');
}

function extractBalancedObjects(output: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0 && start >= 0) {
        objects.push(output.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function imageMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}
