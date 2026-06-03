import sharp from 'sharp';
import { darkenHex, nearestHexColor, rgbToHex, type RgbaColor } from '../color';
import { parsePixelPlan } from '../schema';
import type { AgentProvider } from './agentProvider';
import type {
  AnimationMode,
  DrawOp,
  PixelAnimation,
  PixelFrame,
  PaletteColor,
  PixelLayer,
  PixelPlan,
  PixelRequest,
  SegmentationMode,
  StylePreset
} from '../types';

interface IndexedPixel {
  alpha: number;
  color: string | null;
}

interface CropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class DeterministicProvider implements AgentProvider {
  async analyze(request: PixelRequest): Promise<PixelPlan> {
    if (request.segmentationMode === 'ai-model') {
      throw new Error('Chua co model. Hay chon Khong tach, Tu dong cuc bo, hoac Nhan vat o giua.');
    }

    const source = await prepareSourceImage(request);
    const image = await source
      .resize(request.targetWidth, request.targetHeight, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        fit: 'contain',
        kernel: 'lanczos3',
        withoutEnlargement: false
      })
      .sharpen()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rawPixels = readRgbaPixels(image.data, request.targetWidth, request.targetHeight);
    const needsOutline = request.stylePreset !== 'portrait';
    const sourcePalette = extractPalette(rawPixels, Math.max(1, request.paletteMax - (needsOutline ? 1 : 0)));
    const outlineColor = needsOutline ? pickOutlineColor(sourcePalette) : null;
    const palette = buildFinalPalette(sourcePalette, outlineColor, request.paletteMax);
    const paletteColors = palette.map((color) => color.hex);
    const indexedPixels = denoiseIndexedPixels(indexPixels(rawPixels, paletteColors), request.targetWidth, request.targetHeight);
    const layerPlan = buildLayerPlan({
      indexedPixels,
      rawPixels,
      width: request.targetWidth,
      height: request.targetHeight,
      outlineColor,
      stylePreset: request.stylePreset,
      segmentationMode: request.segmentationMode
    });
    const animationPlan = buildAnimationPlan({
      animationMode: request.animationMode,
      drawOps: layerPlan.drawOps,
      height: request.targetHeight,
      layers: layerPlan.layers,
      palette,
      stylePreset: request.stylePreset,
      width: request.targetWidth
    });

    return parsePixelPlan({
      canvas: {
        width: request.targetWidth,
        height: request.targetHeight,
        transparent: true
      },
      palette,
      layers: layerPlan.layers,
      frames: animationPlan.frames,
      animations: animationPlan.animations,
      drawOps: animationPlan.drawOps,
      artistNotes: [
        `Generated from ${request.stylePreset} preset at ${request.targetWidth}x${request.targetHeight} using local quantization.`,
        `Segmentation mode: ${request.segmentationMode}.`,
        `Animation mode: ${request.animationMode}.`,
        `Palette reduced to ${palette.length} unique colors with weighted k-means and nearest-color mapping.`,
        layerPlan.note,
        animationPlan.note,
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

interface LayerPlanInput {
  indexedPixels: IndexedPixel[];
  rawPixels: RgbaColor[];
  width: number;
  height: number;
  outlineColor: string | null;
  stylePreset: StylePreset;
  segmentationMode: Exclude<SegmentationMode, 'ai-model'>;
}

interface LayerPlanOutput {
  layers: PixelLayer[];
  drawOps: DrawOp[];
  note: string;
}

function buildLayerPlan(input: LayerPlanInput): LayerPlanOutput {
  if (input.segmentationMode === 'none') {
    const layers = input.outlineColor
      ? [
          { name: 'Base', opacity: 1, visible: true },
          { name: 'Outline', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ]
      : [
          { name: 'Base', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ];
    const drawOps = buildPaintLayerOps({
      pixels: input.indexedPixels,
      width: input.width,
      height: input.height,
      baseLayer: 'Base',
      outlineLayer: 'Outline',
      outlineColor: input.outlineColor
    });

    drawOps.push({ op: 'layer', name: 'Edits' });

    return {
      layers,
      drawOps,
      note: 'Generated pixels are on Base, outline pixels are on Outline, and the empty Edits layer is selected for immediate paint-over edits.'
    };
  }

  const subjectMask =
    input.segmentationMode === 'auto-local'
      ? buildAutoSubjectMask(input.rawPixels, input.indexedPixels, input.width, input.height, input.stylePreset)
      : buildCenterSubjectMask(input.rawPixels, input.indexedPixels, input.width, input.height, input.stylePreset);
  const subjectPixels = maskIndexedPixels(input.indexedPixels, subjectMask, true);

  if (input.segmentationMode === 'center-subject') {
    const layers = input.outlineColor
      ? [
          { name: 'Character Base', opacity: 1, visible: true },
          { name: 'Outline', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ]
      : [
          { name: 'Character Base', opacity: 1, visible: true },
          { name: 'Edits', opacity: 1, visible: true }
        ];
    const drawOps = [
      ...buildPaintLayerOps({
        pixels: subjectPixels,
        width: input.width,
        height: input.height,
        baseLayer: 'Character Base',
        outlineLayer: 'Outline',
        outlineColor: input.outlineColor
      }),
      { op: 'layer', name: 'Edits' } satisfies DrawOp
    ];

    return {
      layers,
      drawOps,
      note:
        'Only the centered subject estimate was exported to Character Base. Use this when you want to discard the background and keep the main character.'
    };
  }

  const backgroundPixels = maskIndexedPixels(input.indexedPixels, subjectMask, false);
  const layers = input.outlineColor
    ? [
        { name: 'Background', opacity: 1, visible: true },
        { name: 'Character Base', opacity: 1, visible: true },
        { name: 'Outline', opacity: 1, visible: true },
        { name: 'Edits', opacity: 1, visible: true }
      ]
    : [
        { name: 'Background', opacity: 1, visible: true },
        { name: 'Character Base', opacity: 1, visible: true },
        { name: 'Edits', opacity: 1, visible: true }
      ];
  const drawOps: DrawOp[] = [
    { op: 'layer', name: 'Background' },
    ...buildColorRuns(backgroundPixels, input.width, input.height, 'Background'),
    ...buildPaintLayerOps({
      pixels: subjectPixels,
      width: input.width,
      height: input.height,
      baseLayer: 'Character Base',
      outlineLayer: 'Outline',
      outlineColor: input.outlineColor
    }),
    { op: 'layer', name: 'Edits' }
  ];

  return {
    layers,
    drawOps,
    note: 'Background and Character Base were split by a local heuristic. Review the mask edges and repaint errors on Edits or Character Base.'
  };
}

function buildPaintLayerOps({
  pixels,
  width,
  height,
  baseLayer,
  outlineLayer,
  outlineColor
}: {
  pixels: IndexedPixel[];
  width: number;
  height: number;
  baseLayer: string;
  outlineLayer: string;
  outlineColor: string | null;
}): DrawOp[] {
  const drawOps: DrawOp[] = [{ op: 'layer', name: baseLayer }, ...buildColorRuns(pixels, width, height, baseLayer)];

  if (outlineColor) {
    drawOps.push({ op: 'layer', name: outlineLayer });
    drawOps.push(...buildOutlineRuns(pixels, width, height, outlineColor, outlineLayer));
  }

  return drawOps;
}

interface AnimationPlanInput {
  animationMode: AnimationMode;
  drawOps: DrawOp[];
  height: number;
  layers: PixelLayer[];
  palette: PaletteColor[];
  stylePreset: StylePreset;
  width: number;
}

interface AnimationPlanOutput {
  frames: PixelFrame[];
  animations?: PixelAnimation[];
  drawOps: DrawOp[];
  note: string;
}

interface FrameTransform {
  direction?: string;
  durationMs: number;
  dx: number;
  dy: number;
  flipX?: boolean;
  index: number;
  label: string;
  rotation?: 0 | 90 | 180 | 270;
  shine?: boolean;
}

function buildAnimationPlan(input: AnimationPlanInput): AnimationPlanOutput {
  const transforms = animationTransforms(input.animationMode, input.stylePreset, input.width, input.height);
  const frames = transforms.map((transform) => ({
    index: transform.index,
    durationMs: transform.durationMs,
    label: transform.label
  }));

  if (input.animationMode === 'single') {
    return {
      frames,
      drawOps: input.drawOps,
      note: 'Single-frame output was generated.'
    };
  }

  const drawOps = transforms.flatMap((transform) =>
    buildFrameOps({
      baseOps: input.drawOps,
      height: input.height,
      layers: input.layers,
      palette: input.palette,
      transform,
      width: input.width
    })
  );
  const animations = buildAnimationMetadata(input.animationMode, transforms);

  return {
    frames,
    animations,
    drawOps,
    note:
      input.animationMode === 'topdown-4dir' || input.animationMode === 'topdown-walk-8'
        ? 'Local provider generated geometric top-down direction frames from one view; use an AI provider for real semantic turnarounds with redrawn body parts.'
        : 'Local provider generated lightweight animation frames by transforming the validated layer plan.'
  };
}

function animationTransforms(animationMode: AnimationMode, stylePreset: StylePreset, width: number, height: number): FrameTransform[] {
  const durationMs = usesItemHeuristic(stylePreset) ? 140 : 120;
  const bob = Math.max(1, Math.min(3, Math.round(Math.min(width, height) / 40)));
  const step = Math.max(1, Math.min(3, Math.round(Math.min(width, height) / 48)));

  switch (animationMode) {
    case 'idle-4frame':
      return [
        { index: 1, label: 'Idle Rest', durationMs, dx: 0, dy: 0 },
        { index: 2, label: 'Idle Rise', durationMs, dx: 0, dy: -Math.max(1, bob - 1) },
        { index: 3, label: 'Idle Peak', durationMs, dx: 0, dy: -bob },
        { index: 4, label: 'Idle Fall', durationMs, dx: 0, dy: 1 }
      ];
    case 'topdown-4dir':
      return [
        { index: 1, label: 'Down', direction: 'down', durationMs, dx: 0, dy: 0, rotation: 0 },
        { index: 2, label: 'Left', direction: 'left', durationMs, dx: 0, dy: 0, rotation: 90 },
        { index: 3, label: 'Right', direction: 'right', durationMs, dx: 0, dy: 0, rotation: 270 },
        { index: 4, label: 'Up', direction: 'up', durationMs, dx: 0, dy: 0, rotation: 180 }
      ];
    case 'topdown-walk-8':
      return [
        { index: 1, label: 'Down Walk 1', direction: 'down', durationMs, dx: -step, dy: 0, rotation: 0 },
        { index: 2, label: 'Down Walk 2', direction: 'down', durationMs, dx: step, dy: 0, rotation: 0 },
        { index: 3, label: 'Left Walk 1', direction: 'left', durationMs, dx: -step, dy: -step, rotation: 90 },
        { index: 4, label: 'Left Walk 2', direction: 'left', durationMs, dx: -step, dy: step, rotation: 90 },
        { index: 5, label: 'Right Walk 1', direction: 'right', durationMs, dx: step, dy: -step, rotation: 270 },
        { index: 6, label: 'Right Walk 2', direction: 'right', durationMs, dx: step, dy: step, rotation: 270 },
        { index: 7, label: 'Up Walk 1', direction: 'up', durationMs, dx: -step, dy: 0, rotation: 180 },
        { index: 8, label: 'Up Walk 2', direction: 'up', durationMs, dx: step, dy: 0, rotation: 180 }
      ];
    case 'item-shine-4frame':
      return [
        { index: 1, label: 'Item Shine 1', durationMs, dx: 0, dy: 0 },
        { index: 2, label: 'Item Shine 2', durationMs, dx: 0, dy: 0, shine: true },
        { index: 3, label: 'Item Shine 3', durationMs, dx: 0, dy: 0 },
        { index: 4, label: 'Item Shine 4', durationMs, dx: 0, dy: 0, shine: true }
      ];
    case 'single':
      return [{ index: 1, label: 'Frame 1', durationMs, dx: 0, dy: 0 }];
  }
}

function buildAnimationMetadata(animationMode: AnimationMode, transforms: FrameTransform[]): PixelAnimation[] {
  if (animationMode === 'topdown-walk-8') {
    return [
      { name: 'walk-down', from: 1, to: 2, direction: 'down' },
      { name: 'walk-left', from: 3, to: 4, direction: 'left' },
      { name: 'walk-right', from: 5, to: 6, direction: 'right' },
      { name: 'walk-up', from: 7, to: 8, direction: 'up' }
    ];
  }

  return [
    {
      name: animationMode,
      from: transforms[0]?.index ?? 1,
      to: transforms[transforms.length - 1]?.index ?? 1
    }
  ];
}

function buildFrameOps({
  baseOps,
  height,
  layers,
  palette,
  transform,
  width
}: {
  baseOps: DrawOp[];
  height: number;
  layers: PixelLayer[];
  palette: PaletteColor[];
  transform: FrameTransform;
  width: number;
}): DrawOp[] {
  const output: DrawOp[] = [{ op: 'frame', index: transform.index }];
  const layerNames = new Set(layers.map((layer) => layer.name));
  let currentLayer = layers[0]?.name ?? 'Base';

  for (const op of baseOps) {
    if (op.op === 'frame') continue;

    if (op.op === 'layer') {
      currentLayer = op.name;
      if (layerNames.has(op.name)) output.push(op);
      continue;
    }

    const layer = 'layer' in op && op.layer ? op.layer : currentLayer;
    if (!layerNames.has(layer) || layer === 'Edits') continue;

    const shouldTransform = isSubjectLayer(layer);
    const nextOp = transformDrawOp(op, layer, width, height, shouldTransform ? transform : null);

    if (nextOp) output.push(nextOp);
  }

  if (transform.shine) {
    output.push(...buildShineOps(layers, palette, width, height, transform.index));
  }

  output.push({ op: 'layer', name: 'Edits' });

  return output;
}

function isSubjectLayer(layer: string): boolean {
  return layer !== 'Background' && layer !== 'Edits';
}

function transformDrawOp(
  op: Exclude<DrawOp, { op: 'layer' | 'frame' }>,
  layer: string,
  width: number,
  height: number,
  transform: FrameTransform | null
): DrawOp | null {
  const dx = transform?.dx ?? 0;
  const dy = transform?.dy ?? 0;
  const flipX = transform?.flipX === true;
  const rotation = transform?.rotation ?? 0;

  switch (op.op) {
    case 'setPixel':
      return transformSetPixel(op, layer, width, height, dx, dy, flipX, rotation);
    case 'fillRect':
      return transformBoxOp(op, layer, width, height, dx, dy, flipX, rotation);
    case 'rect':
      return transformBoxOp(op, layer, width, height, dx, dy, flipX, rotation);
    case 'ellipse':
      return transformBoxOp(op, layer, width, height, dx, dy, flipX, rotation);
    case 'line':
      return transformLineOp(op, layer, width, height, dx, dy, flipX, rotation);
  }
}

function transformSetPixel(
  op: Extract<DrawOp, { op: 'setPixel' }>,
  layer: string,
  width: number,
  height: number,
  dx: number,
  dy: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): DrawOp | null {
  const point = transformPoint(op.x, op.y, width, height, dx, dy, flipX, rotation);

  if (!point) return null;

  return {
    ...op,
    layer,
    x: point.x,
    y: point.y
  };
}

function transformBoxOp(
  op: Extract<DrawOp, { op: 'fillRect' | 'rect' | 'ellipse' }>,
  layer: string,
  canvasWidth: number,
  canvasHeight: number,
  dx: number,
  dy: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): DrawOp | null {
  const box = transformBox(op.x, op.y, op.width, op.height, canvasWidth, canvasHeight, dx, dy, flipX, rotation);

  if (!box) return null;

  if (op.op === 'fillRect') {
    return clipFillRect(
      {
        ...op,
        layer,
        ...box
      },
      canvasWidth,
      canvasHeight
    );
  }

  if (box.x < 0 || box.y < 0 || box.x + box.width > canvasWidth || box.y + box.height > canvasHeight) return null;

  return {
    ...op,
    layer,
    ...box
  };
}

function transformLineOp(
  op: Extract<DrawOp, { op: 'line' }>,
  layer: string,
  width: number,
  height: number,
  dx: number,
  dy: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): DrawOp | null {
  const first = transformPoint(op.x1, op.y1, width, height, dx, dy, flipX, rotation);
  const second = transformPoint(op.x2, op.y2, width, height, dx, dy, flipX, rotation);

  if (!first || !second) return null;

  return {
    ...op,
    layer,
    x1: first.x,
    x2: second.x,
    y1: first.y,
    y2: second.y
  };
}

function transformBox(
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  dx: number,
  dy: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): { x: number; y: number; width: number; height: number } | null {
  const points = [
    transformPoint(x, y, canvasWidth, canvasHeight, dx, dy, flipX, rotation),
    transformPoint(x + boxWidth - 1, y, canvasWidth, canvasHeight, dx, dy, flipX, rotation),
    transformPoint(x, y + boxHeight - 1, canvasWidth, canvasHeight, dx, dy, flipX, rotation),
    transformPoint(x + boxWidth - 1, y + boxHeight - 1, canvasWidth, canvasHeight, dx, dy, flipX, rotation)
  ];

  if (points.some((point) => !point)) return null;

  const realPoints = points as Array<{ x: number; y: number }>;
  const left = Math.min(...realPoints.map((point) => point.x));
  const top = Math.min(...realPoints.map((point) => point.y));
  const right = Math.max(...realPoints.map((point) => point.x));
  const bottom = Math.max(...realPoints.map((point) => point.y));

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

function transformPoint(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  dx: number,
  dy: number,
  flipX: boolean,
  rotation: 0 | 90 | 180 | 270
): { x: number; y: number } | null {
  const sourceX = flipX ? canvasWidth - 1 - x : x;
  const centerX = (canvasWidth - 1) / 2;
  const centerY = (canvasHeight - 1) / 2;
  const relativeX = sourceX - centerX;
  const relativeY = y - centerY;
  let rotatedX = relativeX;
  let rotatedY = relativeY;

  if (rotation === 90) {
    rotatedX = -relativeY;
    rotatedY = relativeX;
  } else if (rotation === 180) {
    rotatedX = -relativeX;
    rotatedY = -relativeY;
  } else if (rotation === 270) {
    rotatedX = relativeY;
    rotatedY = -relativeX;
  }

  const nextX = Math.round(centerX + rotatedX) + dx;
  const nextY = Math.round(centerY + rotatedY) + dy;

  if (nextX < 0 || nextY < 0 || nextX >= canvasWidth || nextY >= canvasHeight) return null;

  return {
    x: nextX,
    y: nextY
  };
}

function clipFillRect(
  op: Extract<DrawOp, { op: 'fillRect' }>,
  canvasWidth: number,
  canvasHeight: number
): Extract<DrawOp, { op: 'fillRect' }> | null {
  const left = Math.max(0, op.x);
  const top = Math.max(0, op.y);
  const right = Math.min(canvasWidth, op.x + op.width);
  const bottom = Math.min(canvasHeight, op.y + op.height);

  if (right <= left || bottom <= top) return null;

  return {
    ...op,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function buildShineOps(layers: PixelLayer[], palette: PaletteColor[], width: number, height: number, frameIndex: number): DrawOp[] {
  const shineLayer = layers.some((layer) => layer.name === 'Outline') ? 'Outline' : (layers.find((layer) => layer.name !== 'Background')?.name ?? 'Base');
  const color = pickBrightestPaletteColor(palette);
  const offset = frameIndex % 2 === 0 ? 0 : 2;
  const x1 = Math.max(0, Math.round(width * 0.22) + offset);
  const y1 = Math.max(0, Math.round(height * 0.72));
  const x2 = Math.min(width - 1, Math.round(width * 0.72) + offset);
  const y2 = Math.max(0, Math.round(height * 0.22));

  return [
    { op: 'layer', name: shineLayer },
    {
      op: 'line',
      layer: shineLayer,
      x1,
      y1,
      x2,
      y2,
      color
    }
  ];
}

function pickBrightestPaletteColor(palette: PaletteColor[]): string {
  return [...palette].sort((left, right) => luminance(right.hex) - luminance(left.hex))[0]?.hex ?? '#ffffff';
}

async function prepareSourceImage(request: PixelRequest): Promise<sharp.Sharp> {
  const source = sharp(request.imagePath).ensureAlpha();

  if (request.segmentationMode === 'none' || usesItemHeuristic(request.stylePreset)) {
    return source;
  }

  const crop = await findSourceSubjectCrop(request.imagePath, request.stylePreset);

  return crop ? source.extract(crop) : source;
}

async function findSourceSubjectCrop(imagePath: string, stylePreset: StylePreset): Promise<CropBounds | null> {
  const image = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = image.info.width;
  const height = image.info.height;
  const pixels = readRgbaPixels(image.data, width, height);
  const backgroundSamples = sampleBorderColors(pixels, width, height);
  const roughMask = pixels.map((pixel, index) => {
    if (pixel.a < 16) return false;

    const x = index % width;
    const y = Math.floor(index / width);
    const backgroundDistance = nearestColorDistance(pixel, backgroundSamples);
    const contrast = localContrast(pixels, width, height, x, y);
    const centerWeight = centerFalloff(x, y, width, height);

    return backgroundDistance > 950 || contrast > 1700 || (centerWeight > 0.25 && backgroundDistance > 520);
  });
  const openedMask = openMask(roughMask, width, height);
  const componentMask = keepBestComponent(closeMask(openedMask, width, height), width, height);
  const recoveredMask = recoverNearbyMaskPixels(roughMask, componentMask, width, height, Math.max(2, Math.round(Math.min(width, height) * 0.012)));
  const bounds = boundsForMask(recoveredMask, width, height);

  if (!bounds) return null;

  const imageArea = width * height;
  const cropArea = bounds.width * bounds.height;

  if (cropArea < imageArea * 0.015 || cropArea > imageArea * 0.94) {
    return null;
  }

  const paddingRatio = stylePreset === 'rpg-item' || stylePreset === 'icon' ? 0.14 : 0.07;

  return padCrop(bounds, width, height, Math.max(4, Math.round(Math.min(width, height) * paddingRatio)));
}

function boundsForMask(mask: boolean[], width: number, height: number): CropBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  mask.forEach((value, index) => {
    if (!value) return;

    const x = index % width;
    const y = Math.floor(index / width);

    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  });

  if (right < left || bottom < top) return null;

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

function padCrop(crop: CropBounds, imageWidth: number, imageHeight: number, padding: number): CropBounds {
  const left = Math.max(0, crop.left - padding);
  const top = Math.max(0, crop.top - padding);
  const right = Math.min(imageWidth, crop.left + crop.width + padding);
  const bottom = Math.min(imageHeight, crop.top + crop.height + padding);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
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

function buildAutoSubjectMask(
  rawPixels: RgbaColor[],
  indexedPixels: IndexedPixel[],
  width: number,
  height: number,
  stylePreset: StylePreset
): boolean[] {
  if (usesCenteredSubjectHeuristic(stylePreset)) {
    const centeredMask = buildCenterSubjectMask(rawPixels, indexedPixels, width, height, stylePreset);
    const centeredArea = countMaskPixels(centeredMask);
    const imageArea = width * height;

    if (centeredArea >= Math.max(6, imageArea * 0.002) && centeredArea <= imageArea * 0.42) {
      return centeredMask;
    }
  }

  if (usesItemHeuristic(stylePreset)) {
    return buildItemSubjectMask(rawPixels, indexedPixels, width, height);
  }

  const backgroundSamples = sampleBorderColors(rawPixels, width, height);
  const roughMask = rawPixels.map((pixel, index) => {
    if (!indexedPixels[index]?.color || pixel.a < 16) return false;

    const x = index % width;
    const y = Math.floor(index / width);
    const backgroundDistance = nearestColorDistance(pixel, backgroundSamples);
    const contrast = localContrast(rawPixels, width, height, x, y);
    const centerWeight = centerFalloff(x, y, width, height);
    const threshold = 850 + centerWeight * 900;

    return backgroundDistance > threshold || contrast > 1450 || (centerWeight > 0.18 && backgroundDistance > threshold * 0.65);
  });

  const closedMask = closeMask(openMask(roughMask, width, height), width, height);
  const componentMask = keepBestComponent(closedMask, width, height);
  const recoveredMask = recoverNearbyMaskPixels(roughMask, componentMask, width, height, Math.max(1, Math.round(Math.min(width, height) * 0.03)));

  return growSubjectMask(recoveredMask, rawPixels, indexedPixels, backgroundSamples, width, height, 2, {
    contrastThreshold: 520,
    distanceThreshold: 360
  });
}

function buildItemSubjectMask(rawPixels: RgbaColor[], indexedPixels: IndexedPixel[], width: number, height: number): boolean[] {
  const backgroundSamples = sampleBorderColors(rawPixels, width, height);
  const scores = rawPixels.map((pixel, index) => scoreItemPixel(pixel, index, rawPixels, indexedPixels, backgroundSamples, width, height));
  const opaqueScores = scores.filter((score) => score.opaque);
  const distanceThreshold = percentile(
    opaqueScores.map((score) => score.backgroundDistance),
    0.9
  );
  const contrastThreshold = percentile(
    opaqueScores.map((score) => score.contrast),
    0.91
  );
  const roughMask = scores.map((score) => {
    if (!score.opaque) return false;

    return (
      (score.backgroundDistance >= distanceThreshold && score.contrast >= contrastThreshold * 0.18) ||
      score.contrast >= contrastThreshold ||
      (score.centerWeight > 0.18 &&
        score.backgroundDistance >= distanceThreshold * 0.78 &&
        score.contrast >= contrastThreshold * 0.42)
    );
  });
  const connectedMask = closeMask(roughMask, width, height);
  const componentMask = keepBestComponent(connectedMask, width, height);
  const recoveredMask = recoverNearbyMaskPixels(roughMask, componentMask, width, height, 1);

  return growSubjectMask(recoveredMask, rawPixels, indexedPixels, backgroundSamples, width, height, 1, {
    contrastThreshold: Math.max(1200, contrastThreshold * 0.42),
    distanceThreshold: Math.max(1600, distanceThreshold * 0.72)
  });
}

interface ItemPixelScore {
  backgroundDistance: number;
  centerWeight: number;
  contrast: number;
  opaque: boolean;
}

function scoreItemPixel(
  pixel: RgbaColor,
  index: number,
  rawPixels: RgbaColor[],
  indexedPixels: IndexedPixel[],
  backgroundSamples: RgbaColor[],
  width: number,
  height: number
): ItemPixelScore {
  if (!indexedPixels[index]?.color || pixel.a < 16) {
    return {
      backgroundDistance: 0,
      centerWeight: 0,
      contrast: 0,
      opaque: false
    };
  }

  const x = index % width;
  const y = Math.floor(index / width);

  return {
    backgroundDistance: nearestColorDistance(pixel, backgroundSamples),
    centerWeight: centerFalloff(x, y, width, height),
    contrast: localContrast(rawPixels, width, height, x, y),
    opaque: true
  };
}

function buildCenterSubjectMask(
  rawPixels: RgbaColor[],
  indexedPixels: IndexedPixel[],
  width: number,
  height: number,
  stylePreset: StylePreset
): boolean[] {
  const geometry = subjectGeometry(width, height, stylePreset);
  const annulusSamples = sampleAnnulusColors(rawPixels, indexedPixels, width, height, geometry);
  const seedMask = indexedPixels.map((pixel, index) => {
    if (!pixel.color) return false;

    const x = index % width;
    const y = Math.floor(index / width);
    const normalized = ellipseScore(x, y, geometry.centerX, geometry.centerY, geometry.radiusX, geometry.radiusY);
    if (normalized > 1) return false;

    const rawPixel = rawPixels[index] ?? { r: 0, g: 0, b: 0, a: 0 };
    const backgroundDistance = nearestColorDistance(rawPixel, annulusSamples);
    const contrast = localContrast(rawPixels, width, height, x, y);
    const corePixel = normalized <= 0.45;
    const threshold = stylePreset === 'portrait' ? 950 : 1250;

    return backgroundDistance > threshold || contrast > 1800 || (corePixel && backgroundDistance > threshold * 0.55);
  });
  const closedMask = closeMask(seedMask, width, height);
  const componentMask = keepBestSubjectComponent(closedMask, width, height, geometry);
  const expandedMask = expandMask(componentMask, width, height, Math.max(1, Math.round(Math.min(width, height) * 0.012)));
  const minArea = Math.max(4, Math.round(width * height * 0.0018));

  if (countMaskPixels(expandedMask) < minArea) {
    return buildFallbackCenterMask(indexedPixels, width, height, geometry);
  }

  return indexedPixels.map((pixel, index) => Boolean(pixel.color && expandedMask[index]));
}

interface SubjectGeometry {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

function usesCenteredSubjectHeuristic(stylePreset: StylePreset): boolean {
  return (
    stylePreset === 'top-down-character' ||
    stylePreset === 'platformer-sprite' ||
    stylePreset === 'side-view-character' ||
    stylePreset === 'portrait'
  );
}

function usesItemHeuristic(stylePreset: StylePreset): boolean {
  return stylePreset === 'rpg-item' || stylePreset === 'icon' || stylePreset === 'isometric-prop' || stylePreset === 'tileset-prop';
}

function subjectGeometry(width: number, height: number, stylePreset: StylePreset): SubjectGeometry {
  if (usesItemHeuristic(stylePreset)) {
    return {
      centerX: width / 2,
      centerY: height / 2,
      radiusX: width * 0.42,
      radiusY: height * 0.42
    };
  }

  if (stylePreset === 'portrait') {
    return {
      centerX: width / 2,
      centerY: height * 0.48,
      radiusX: width * 0.34,
      radiusY: height * 0.42
    };
  }

  if (stylePreset === 'platformer-sprite') {
    return {
      centerX: width / 2,
      centerY: height * 0.5,
      radiusX: width * 0.2,
      radiusY: height * 0.34
    };
  }

  if (stylePreset === 'side-view-character') {
    return {
      centerX: width / 2,
      centerY: height * 0.52,
      radiusX: width * 0.26,
      radiusY: height * 0.38
    };
  }

  return {
    centerX: width / 2,
    centerY: height * 0.42,
    radiusX: width * 0.18,
    radiusY: height * 0.28
  };
}

function sampleAnnulusColors(
  rawPixels: RgbaColor[],
  indexedPixels: IndexedPixel[],
  width: number,
  height: number,
  geometry: SubjectGeometry
): RgbaColor[] {
  const samples: RgbaColor[] = [];
  const innerRadiusX = geometry.radiusX * 0.95;
  const innerRadiusY = geometry.radiusY * 0.95;
  const outerRadiusX = geometry.radiusX * 1.65;
  const outerRadiusY = geometry.radiusY * 1.65;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!indexedPixels[index]?.color) continue;

      const innerScore = ellipseScore(x, y, geometry.centerX, geometry.centerY, innerRadiusX, innerRadiusY);
      const outerScore = ellipseScore(x, y, geometry.centerX, geometry.centerY, outerRadiusX, outerRadiusY);

      if (innerScore > 1 && outerScore <= 1) {
        pushOpaque(samples, rawPixels[index]);
      }
    }
  }

  return samples.length >= 4 ? samples : sampleBorderColors(rawPixels, width, height);
}

function ellipseScore(x: number, y: number, centerX: number, centerY: number, radiusX: number, radiusY: number): number {
  return ((x - centerX) ** 2) / Math.max(radiusX ** 2, 1) + ((y - centerY) ** 2) / Math.max(radiusY ** 2, 1);
}

function localContrast(pixels: RgbaColor[], width: number, height: number, x: number, y: number): number {
  const center = pixels[y * width + x];
  if (!center) return 0;

  let best = 0;
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ] as const;

  for (const [xx, yy] of neighbors) {
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;

    const neighbor = pixels[yy * width + xx];
    if (neighbor) {
      best = Math.max(best, colorDistance(center, neighbor));
    }
  }

  return best;
}

function keepBestSubjectComponent(mask: boolean[], width: number, height: number, geometry: SubjectGeometry): boolean[] {
  const visited = new Set<number>();
  let bestComponent: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  const expectedMaxArea = Math.max(12, Math.round(width * height * 0.22));

  mask.forEach((value, startIndex) => {
    if (!value || visited.has(startIndex)) return;

    const component = collectComponent(mask, visited, width, height, startIndex);
    const proximityScore = component.reduce((score, index) => {
      const x = index % width;
      const y = Math.floor(index / width);

      return score + Math.max(0, 1 - ellipseScore(x, y, geometry.centerX, geometry.centerY, geometry.radiusX, geometry.radiusY));
    }, 0);
    const areaPenalty = Math.max(0, component.length - expectedMaxArea) * 0.08;
    const score = proximityScore + Math.sqrt(component.length) * 0.5 - areaPenalty;

    if (score > bestScore) {
      bestComponent = component;
      bestScore = score;
    }
  });

  if (bestComponent.length === 0) return mask;

  const output = new Array<boolean>(mask.length).fill(false);
  bestComponent.forEach((index) => {
    output[index] = true;
  });

  return output;
}

function buildFallbackCenterMask(indexedPixels: IndexedPixel[], width: number, height: number, geometry: SubjectGeometry): boolean[] {
  const fallbackRadiusX = geometry.radiusX * 0.72;
  const fallbackRadiusY = geometry.radiusY * 0.78;

  return indexedPixels.map((pixel, index) => {
    if (!pixel.color) return false;

    const x = index % width;
    const y = Math.floor(index / width);

    return ellipseScore(x, y, geometry.centerX, geometry.centerY, fallbackRadiusX, fallbackRadiusY) <= 1;
  });
}

function countMaskPixels(mask: boolean[]): number {
  return mask.reduce((count, value) => count + (value ? 1 : 0), 0);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));

  return sorted[index] ?? 0;
}

function recoverNearbyMaskPixels(
  roughMask: boolean[],
  coreMask: boolean[],
  width: number,
  height: number,
  iterations: number
): boolean[] {
  const expandedCore = expandMask(coreMask, width, height, iterations);

  return roughMask.map((value, index) => Boolean(coreMask[index] || (value && expandedCore[index])));
}

function growSubjectMask(
  mask: boolean[],
  rawPixels: RgbaColor[],
  indexedPixels: IndexedPixel[],
  backgroundSamples: RgbaColor[],
  width: number,
  height: number,
  iterations: number,
  thresholds: {
    contrastThreshold: number;
    distanceThreshold: number;
  }
): boolean[] {
  let grown = mask;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const expanded = dilateMask(grown, width, height);

    grown = expanded.map((value, index) => {
      if (!value || grown[index]) return Boolean(grown[index]);
      if (!indexedPixels[index]?.color) return false;

      const pixel = rawPixels[index];
      if (!pixel || pixel.a < 16) return false;

      const x = index % width;
      const y = Math.floor(index / width);
      const backgroundDistance = nearestColorDistance(pixel, backgroundSamples);
      const contrast = localContrast(rawPixels, width, height, x, y);

      return backgroundDistance > thresholds.distanceThreshold || contrast > thresholds.contrastThreshold;
    });
  }

  return closeMask(grown, width, height);
}

function maskIndexedPixels(pixels: IndexedPixel[], mask: boolean[], keepMasked: boolean): IndexedPixel[] {
  return pixels.map((pixel, index) => {
    if (Boolean(mask[index]) === keepMasked) return pixel;

    return {
      alpha: 0,
      color: null
    };
  });
}

function sampleBorderColors(pixels: RgbaColor[], width: number, height: number): RgbaColor[] {
  const samples: RgbaColor[] = [];

  for (let x = 0; x < width; x += 1) {
    pushOpaque(samples, pixels[x]);
    pushOpaque(samples, pixels[(height - 1) * width + x]);
  }

  for (let y = 0; y < height; y += 1) {
    pushOpaque(samples, pixels[y * width]);
    pushOpaque(samples, pixels[y * width + width - 1]);
  }

  return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0, a: 255 }];
}

function pushOpaque(samples: RgbaColor[], color: RgbaColor | undefined): void {
  if (color && color.a >= 16) {
    samples.push(color);
  }
}

function nearestColorDistance(color: RgbaColor, samples: RgbaColor[]): number {
  return samples.reduce((best, sample) => Math.min(best, colorDistance(color, sample)), Number.POSITIVE_INFINITY);
}

function centerFalloff(x: number, y: number, width: number, height: number): number {
  const dx = (x - width / 2) / Math.max(width / 2, 1);
  const dy = (y - height / 2) / Math.max(height / 2, 1);

  return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
}

function openMask(mask: boolean[], width: number, height: number): boolean[] {
  return dilateMask(erodeMask(mask, width, height), width, height);
}

function closeMask(mask: boolean[], width: number, height: number): boolean[] {
  return erodeMask(dilateMask(mask, width, height), width, height);
}

function erodeMask(mask: boolean[], width: number, height: number): boolean[] {
  return mask.map((value, index) => {
    if (!value) return false;

    const x = index % width;
    const y = Math.floor(index / width);

    return countMaskNeighbors(mask, width, height, x, y, true) >= 4;
  });
}

function dilateMask(mask: boolean[], width: number, height: number): boolean[] {
  return mask.map((value, index) => {
    if (value) return true;

    const x = index % width;
    const y = Math.floor(index / width);

    return countMaskNeighbors(mask, width, height, x, y, false) >= 1;
  });
}

function expandMask(mask: boolean[], width: number, height: number, iterations: number): boolean[] {
  let expanded = mask;

  for (let index = 0; index < iterations; index += 1) {
    expanded = dilateMask(expanded, width, height);
  }

  return expanded;
}

function countMaskNeighbors(mask: boolean[], width: number, height: number, x: number, y: number, includeSelf: boolean): number {
  let count = 0;

  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      if (!includeSelf && xx === x && yy === y) continue;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      if (mask[yy * width + xx]) count += 1;
    }
  }

  return count;
}

function keepBestComponent(mask: boolean[], width: number, height: number): boolean[] {
  const visited = new Set<number>();
  let bestComponent: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  mask.forEach((value, startIndex) => {
    if (!value || visited.has(startIndex)) return;

    const component = collectComponent(mask, visited, width, height, startIndex);
    const score = scoreComponent(component, width, height);

    if (score > bestScore) {
      bestComponent = component;
      bestScore = score;
    }
  });

  if (bestComponent.length === 0) return mask;

  const output = new Array<boolean>(mask.length).fill(false);
  bestComponent.forEach((index) => {
    output[index] = true;
  });

  return output;
}

function collectComponent(mask: boolean[], visited: Set<number>, width: number, height: number, startIndex: number): number[] {
  const queue = [startIndex];
  const component: number[] = [];
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    if (index === undefined) continue;

    component.push(index);

    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] as const;

    for (const [xx, yy] of neighbors) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;

      const neighborIndex = yy * width + xx;
      if (!mask[neighborIndex] || visited.has(neighborIndex)) continue;

      visited.add(neighborIndex);
      queue.push(neighborIndex);
    }
  }

  return component;
}

function scoreComponent(component: number[], width: number, height: number): number {
  const centerScore = component.reduce((score, index) => score + centerFalloff(index % width, Math.floor(index / width), width, height), 0);
  const areaScore = Math.sqrt(component.length);

  return centerScore + areaScore;
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

function buildOutlineRuns(pixels: IndexedPixel[], width: number, height: number, color: string, layer: string): DrawOp[] {
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
          layer,
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
