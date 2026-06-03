import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assertSemanticIdentityMatchesReference } from '../semanticIdentityGuard';
import type { PixelPlan, PixelRequest } from '../types';

const request: PixelRequest = {
  imagePath: 'reference.png',
  targetWidth: 64,
  targetHeight: 64,
  paletteMax: 16,
  stylePreset: 'top-down-character',
  segmentationMode: 'none',
  animationMode: 'topdown-4dir',
  outputName: 'bug'
};

describe('assertSemanticIdentityMatchesReference', () => {
  it('rejects semantic turnarounds whose palette drifts away from the reference', async () => {
    const reference = await createReferenceImage();
    const plan: PixelPlan = {
      canvas: {
        width: 64,
        height: 64,
        transparent: true
      },
      palette: [
        { name: 'outline', hex: '#1b1020' },
        { name: 'purple', hex: '#8c3fa6' },
        { name: 'yellow', hex: '#f0c47c' },
        { name: 'white', hex: '#f6f0ff' },
        { name: 'cyan', hex: '#88c9d8' }
      ],
      layers: [{ name: 'Character Base' }],
      frames: [{ index: 1, durationMs: 120, label: 'Down' }],
      animations: [{ name: 'topdown-4dir', from: 1, to: 1 }],
      drawOps: [
        { op: 'frame', index: 1 },
        { op: 'layer', name: 'Character Base' },
        { op: 'fillRect', layer: 'Character Base', x: 20, y: 20, width: 8, height: 8, color: '#8c3fa6' }
      ],
      artistNotes: ['test']
    };

    await expect(assertSemanticIdentityMatchesReference(request, reference, plan)).rejects.toThrow(/palette drifted/i);
  });

  it('accepts semantic turnarounds that keep the reference hue family', async () => {
    const reference = await createReferenceImage();
    const plan: PixelPlan = {
      canvas: {
        width: 64,
        height: 64,
        transparent: true
      },
      palette: [
        { name: 'body', hex: '#142528' },
        { name: 'shadow', hex: '#091214' },
        { name: 'green', hex: '#31c96c' },
        { name: 'background', hex: '#5d4a4e' }
      ],
      layers: [{ name: 'Character Base' }],
      frames: [{ index: 1, durationMs: 120, label: 'Down' }],
      animations: [{ name: 'topdown-4dir', from: 1, to: 1 }],
      drawOps: [
        { op: 'frame', index: 1 },
        { op: 'layer', name: 'Character Base' },
        { op: 'fillRect', layer: 'Character Base', x: 20, y: 20, width: 8, height: 8, color: '#142528' }
      ],
      artistNotes: ['test']
    };

    await expect(assertSemanticIdentityMatchesReference(request, reference, plan)).resolves.toBeUndefined();
  });
});

async function createReferenceImage(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'asepilot-identity-'));
  const reference = join(directory, 'reference.png');

  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: '#5d4a4eff'
    }
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 14,
            height: 18,
            channels: 4,
            background: '#142528ff'
          }
        })
          .png()
          .toBuffer(),
        left: 9,
        top: 8
      },
      {
        input: await sharp({
          create: {
            width: 6,
            height: 6,
            channels: 4,
            background: '#31c96cff'
          }
        })
          .png()
          .toBuffer(),
        left: 4,
        top: 5
      }
    ])
    .png()
    .toFile(reference);

  return reference;
}
