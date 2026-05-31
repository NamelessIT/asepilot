import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderPlanToPng } from '../planRenderer';
import { DeterministicProvider } from '../providers/deterministicProvider';

describe('DeterministicProvider', () => {
  it('turns a real image into a valid plan and preview png', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'source.png');
    const preview = join(directory, 'preview.png');

    await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: '#d0952fff'
      }
    })
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 8,
      targetHeight: 8,
      paletteMax: 8,
      stylePreset: 'icon',
      outputName: 'test-sprite'
    });

    await renderPlanToPng(plan, preview);

    expect(plan.canvas.width).toBe(8);
    expect(plan.layers.length).toBeGreaterThan(0);
    expect(plan.drawOps.length).toBeGreaterThan(0);
    await expect(stat(preview)).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });
});

