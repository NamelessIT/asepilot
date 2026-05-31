import { z } from 'zod';
import { STYLE_PRESETS, type DrawOp, type PixelPlan, type PixelRequest } from './types';

export const MAX_CANVAS_SIZE = 256;
export const MAX_FRAMES = 64;
export const MAX_DRAW_OPS = MAX_CANVAS_SIZE * MAX_CANVAS_SIZE * 2;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const layerNameSchema = z.string().trim().min(1).max(64).regex(/^[\w .-]+$/);

export const pixelRequestSchema = z.object({
  imagePath: z.string().trim().min(1),
  targetWidth: z.number().int().min(1).max(MAX_CANVAS_SIZE),
  targetHeight: z.number().int().min(1).max(MAX_CANVAS_SIZE),
  paletteMax: z.number().int().min(2).max(64),
  stylePreset: z.enum(STYLE_PRESETS),
  outputName: z.string().trim().min(1).max(80).regex(/^[\w .-]+$/)
});

const baseLayerOp = {
  layer: layerNameSchema.optional()
};

const drawOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('layer'),
    name: layerNameSchema
  }),
  z.object({
    op: z.literal('frame'),
    index: z.number().int().min(1).max(MAX_FRAMES)
  }),
  z.object({
    ...baseLayerOp,
    op: z.literal('setPixel'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    color: hexColorSchema
  }),
  z.object({
    ...baseLayerOp,
    op: z.literal('fillRect'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    color: hexColorSchema
  }),
  z.object({
    ...baseLayerOp,
    op: z.literal('rect'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    color: hexColorSchema
  }),
  z.object({
    ...baseLayerOp,
    op: z.literal('line'),
    x1: z.number().int().min(0),
    y1: z.number().int().min(0),
    x2: z.number().int().min(0),
    y2: z.number().int().min(0),
    color: hexColorSchema
  }),
  z.object({
    ...baseLayerOp,
    op: z.literal('ellipse'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    color: hexColorSchema,
    fill: z.boolean().optional()
  })
]);

export const pixelPlanSchema = z
  .object({
    canvas: z.object({
      width: z.number().int().min(1).max(MAX_CANVAS_SIZE),
      height: z.number().int().min(1).max(MAX_CANVAS_SIZE),
      transparent: z.boolean()
    }),
    palette: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(64),
          hex: hexColorSchema.transform((value) => value.toLowerCase())
        })
      )
      .min(1)
      .max(64),
    layers: z
      .array(
        z.object({
          name: layerNameSchema,
          opacity: z.number().min(0).max(1).optional(),
          visible: z.boolean().optional()
        })
      )
      .min(1)
      .max(32),
    drawOps: z.array(drawOpSchema).max(MAX_DRAW_OPS),
    artistNotes: z.array(z.string().trim().min(1).max(280)).max(20)
  })
  .superRefine((plan, ctx) => {
    const paletteColors = new Set(plan.palette.map((color) => color.hex.toLowerCase()));
    const layerNames = new Set(plan.layers.map((layer) => layer.name));

    if (paletteColors.size !== plan.palette.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Palette colors must be unique.',
        path: ['palette']
      });
    }

    if (layerNames.size !== plan.layers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Layer names must be unique.',
        path: ['layers']
      });
    }

    plan.drawOps.forEach((op, index) => {
      validateDrawOpBounds(op, plan, ctx, index);
      validateDrawOpReferences(op, paletteColors, layerNames, ctx, index);
    });
  });

function validateDrawOpBounds(op: DrawOp, plan: PixelPlan, ctx: z.RefinementCtx, index: number): void {
  const width = plan.canvas.width;
  const height = plan.canvas.height;
  const addBoundsIssue = (message: string): void => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: ['drawOps', index]
    });
  };

  switch (op.op) {
    case 'layer':
    case 'frame':
      return;
    case 'setPixel':
      if (op.x >= width || op.y >= height) addBoundsIssue('Pixel is outside the canvas.');
      return;
    case 'fillRect':
    case 'rect':
    case 'ellipse':
      if (op.x + op.width > width || op.y + op.height > height) {
        addBoundsIssue(`${op.op} is outside the canvas.`);
      }
      return;
    case 'line':
      if (op.x1 >= width || op.x2 >= width || op.y1 >= height || op.y2 >= height) {
        addBoundsIssue('Line is outside the canvas.');
      }
      return;
  }
}

function validateDrawOpReferences(
  op: DrawOp,
  paletteColors: Set<string>,
  layerNames: Set<string>,
  ctx: z.RefinementCtx,
  index: number
): void {
  if ('color' in op && !paletteColors.has(op.color.toLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Draw op color ${op.color} is not present in palette.`,
      path: ['drawOps', index, 'color']
    });
  }

  if ('layer' in op && op.layer && !layerNames.has(op.layer)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Draw op layer ${op.layer} is not declared.`,
      path: ['drawOps', index, 'layer']
    });
  }

  if (op.op === 'layer' && !layerNames.has(op.name)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Layer switch ${op.name} is not declared.`,
      path: ['drawOps', index, 'name']
    });
  }
}

export function parsePixelRequest(value: unknown): PixelRequest {
  return pixelRequestSchema.parse(value);
}

export function parsePixelPlan(value: unknown): PixelPlan {
  return pixelPlanSchema.parse(value);
}

export function sanitizeOutputName(value: string): string {
  const safe = value.trim().replace(/[^\w .-]+/g, '-').replace(/\s+/g, '-');
  return safe.length > 0 ? safe.slice(0, 80) : `asepilot-${Date.now()}`;
}

