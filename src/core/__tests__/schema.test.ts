import { describe, expect, it } from 'vitest';
import { parsePixelPlan } from '../schema';
import type { PixelPlan } from '../types';

const validPlan: PixelPlan = {
  canvas: {
    width: 8,
    height: 8,
    transparent: true
  },
  palette: [
    {
      name: 'ink',
      hex: '#101820'
    },
    {
      name: 'gold',
      hex: '#d0952f'
    }
  ],
  layers: [
    {
      name: 'Base'
    }
  ],
  drawOps: [
    {
      op: 'fillRect',
      layer: 'Base',
      x: 1,
      y: 1,
      width: 4,
      height: 2,
      color: '#d0952f'
    }
  ],
  artistNotes: ['test']
};

describe('parsePixelPlan', () => {
  it('accepts a valid constrained plan', () => {
    expect(parsePixelPlan(validPlan).canvas.width).toBe(8);
  });

  it('rejects colors that are not in the palette', () => {
    expect(() =>
      parsePixelPlan({
        ...validPlan,
        drawOps: [
          {
            op: 'setPixel',
            layer: 'Base',
            x: 0,
            y: 0,
            color: '#ff00ff'
          }
        ]
      })
    ).toThrow(/not present in palette/i);
  });

  it('rejects out-of-bounds operations', () => {
    expect(() =>
      parsePixelPlan({
        ...validPlan,
        drawOps: [
          {
            op: 'fillRect',
            layer: 'Base',
            x: 7,
            y: 7,
            width: 2,
            height: 1,
            color: '#101820'
          }
        ]
      })
    ).toThrow(/outside the canvas/i);
  });

  it('rejects unknown operations', () => {
    expect(() =>
      parsePixelPlan({
        ...validPlan,
        drawOps: [
          {
            op: 'rawLua',
            code: 'app.command.SaveFile()'
          }
        ]
      })
    ).toThrow();
  });

  it('rejects oversized canvases', () => {
    expect(() =>
      parsePixelPlan({
        ...validPlan,
        canvas: {
          width: 512,
          height: 8,
          transparent: true
        }
      })
    ).toThrow();
  });
});

