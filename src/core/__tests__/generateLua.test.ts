import { describe, expect, it } from 'vitest';
import { generateAsepriteLua } from '../lua/generateLua';
import type { PixelPlan } from '../types';

describe('generateAsepriteLua', () => {
  it('emits trusted Lua from a validated plan', () => {
    const plan: PixelPlan = {
      canvas: {
        width: 4,
        height: 4,
        transparent: true
      },
      palette: [
        {
          name: 'ink',
          hex: '#101820'
        }
      ],
      layers: [
        {
          name: 'Base'
        },
        {
          name: 'Edits'
        }
      ],
      drawOps: [
        {
          op: 'layer',
          name: 'Base'
        },
        {
          op: 'fillRect',
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          color: '#101820'
        }
      ],
      artistNotes: ['test']
    };

    const lua = generateAsepriteLua(plan, {
      asepriteFile: 'C:/tmp/test.aseprite',
      pngFile: 'C:/tmp/test.png'
    });

    expect(lua).toContain('Sprite(4, 4, ColorMode.RGB)');
    expect(lua).toContain('colors["#101820"] = pc.rgba(16, 24, 32, 255)');
    expect(lua).toContain('fillRect(currentLayer, 1, 1, 2, 2, "#101820")');
    expect(lua).toContain('app.activeLayer = layers["Edits"]');
    expect(lua).toContain('SaveFileAs');
    expect(lua).not.toContain('app.command.DoScript');
  });
});
