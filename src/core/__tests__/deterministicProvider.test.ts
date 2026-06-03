import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderPlanToPng } from '../planRenderer';
import { DeterministicProvider } from '../providers/deterministicProvider';
import { ANIMATION_MODES, STYLE_PRESETS } from '../types';

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
      segmentationMode: 'none',
      animationMode: 'single',
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

  it('keeps palette colors unique for large single-color renders', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'solid-black.png');

    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: '#000000ff'
      }
    })
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 128,
      targetHeight: 128,
      paletteMax: 16,
      stylePreset: 'icon',
      segmentationMode: 'none',
      animationMode: 'single',
      outputName: 'solid-black'
    });
    const colors = plan.palette.map((color) => color.hex);

    expect(new Set(colors).size).toBe(colors.length);
  });

  it('can split generated pixels into background and character layers locally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'subject.png');

    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: '#202020ff'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 8,
              height: 8,
              channels: 4,
              background: '#d02020ff'
            }
          })
            .png()
            .toBuffer(),
          left: 8,
          top: 8
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 64,
      targetHeight: 64,
      paletteMax: 12,
      stylePreset: 'icon',
      segmentationMode: 'auto-local',
      animationMode: 'single',
      outputName: 'subject'
    });
    const layerNames = plan.layers.map((layer) => layer.name);

    expect(layerNames).toContain('Background');
    expect(layerNames).toContain('Character Base');
    expect(plan.drawOps.some((op) => 'layer' in op && op.layer === 'Character Base')).toBe(true);
  });

  it('can export only the centered subject without a background layer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'center-subject.png');

    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: '#202020ff'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 8,
              height: 8,
              channels: 4,
              background: '#d02020ff'
            }
          })
            .png()
            .toBuffer(),
          left: 8,
          top: 8
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 64,
      targetHeight: 64,
      paletteMax: 12,
      stylePreset: 'icon',
      segmentationMode: 'center-subject',
      animationMode: 'single',
      outputName: 'center-subject'
    });
    const layerNames = plan.layers.map((layer) => layer.name);

    expect(layerNames).toContain('Character Base');
    expect(layerNames).not.toContain('Background');
  });

  it('reports AI segmentation as unavailable until a model provider exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'source.png');

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

    await expect(
      provider.analyze({
        imagePath: source,
        targetWidth: 8,
        targetHeight: 8,
        paletteMax: 8,
        stylePreset: 'icon',
        segmentationMode: 'ai-model',
        animationMode: 'single',
        outputName: 'ai'
      })
    ).rejects.toThrow(/chua co model/i);
  });

  it('can scaffold top-down walk frames locally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'walker.png');
    const preview = join(directory, 'walker-preview.png');

    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: '#00000000'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 8,
              height: 12,
              channels: 4,
              background: '#3366ccff'
            }
          })
            .png()
            .toBuffer(),
          left: 8,
          top: 6
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 32,
      targetHeight: 32,
      paletteMax: 12,
      stylePreset: 'top-down-character',
      segmentationMode: 'center-subject',
      animationMode: 'topdown-walk-8',
      outputName: 'walker'
    });

    await renderPlanToPng(plan, preview);

    expect(plan.frames).toHaveLength(8);
    expect(plan.animations?.map((animation) => animation.name)).toEqual(['walk-down', 'walk-left', 'walk-right', 'walk-up']);
    expect(plan.drawOps.filter((op) => op.op === 'frame')).toHaveLength(8);
    await expect(stat(preview)).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });

  it('renders local idle frames as distinct poses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'idle-source.png');
    const preview = join(directory, 'idle-preview.png');

    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: '#00000000'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 10,
              height: 14,
              channels: 4,
              background: '#3366ccff'
            }
          })
            .png()
            .toBuffer(),
          left: 11,
          top: 12
        },
        {
          input: await sharp({
            create: {
              width: 8,
              height: 8,
              channels: 4,
              background: '#d8b45cff'
            }
          })
            .png()
            .toBuffer(),
          left: 12,
          top: 6
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 64,
      targetHeight: 64,
      paletteMax: 12,
      stylePreset: 'top-down-character',
      segmentationMode: 'center-subject',
      animationMode: 'idle-4frame',
      outputName: 'idle'
    });

    await renderPlanToPng(plan, preview);

    const frameHashes = await readFrameHashes(preview, plan.canvas.width, plan.canvas.height);

    expect(plan.frames).toHaveLength(4);
    expect(new Set(frameHashes).size).toBe(4);
  });

  it('renders top-down four-direction frames by rotating the subject orientation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'topdown-marker.png');
    const preview = join(directory, 'topdown-marker-preview.png');

    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: '#00000000'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 10,
              height: 14,
              channels: 4,
              background: '#102028ff'
            }
          })
            .png()
            .toBuffer(),
          left: 11,
          top: 8
        },
        {
          input: await sharp({
            create: {
              width: 4,
              height: 4,
              channels: 4,
              background: '#32e875ff'
            }
          })
            .png()
            .toBuffer(),
          left: 14,
          top: 22
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();
    const plan = await provider.analyze({
      imagePath: source,
      targetWidth: 64,
      targetHeight: 64,
      paletteMax: 12,
      stylePreset: 'top-down-character',
      segmentationMode: 'none',
      animationMode: 'topdown-4dir',
      outputName: 'topdown-marker'
    });

    await renderPlanToPng(plan, preview);

    const greenCenters = await readGreenFrameCenters(preview, plan.canvas.width, plan.canvas.height);
    const centerX = plan.canvas.width / 2;
    const centerY = plan.canvas.height / 2;

    expect(plan.frames?.map((frame) => frame.label)).toEqual(['Down', 'Left', 'Right', 'Up']);
    expect(greenCenters[0]?.y).toBeGreaterThan(centerY);
    expect(greenCenters[1]?.x).toBeLessThan(centerX);
    expect(greenCenters[2]?.x).toBeGreaterThan(centerX);
    expect(greenCenters[3]?.y).toBeLessThan(centerY);
  });

  it('supports every local style and animation combination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'asepilot-'));
    const source = join(directory, 'matrix-source.png');

    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: '#f2efe4ff'
      }
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 12,
              height: 16,
              channels: 4,
              background: '#3f6f3fff'
            }
          })
            .png()
            .toBuffer(),
          left: 10,
          top: 8
        },
        {
          input: await sharp({
            create: {
              width: 6,
              height: 6,
              channels: 4,
              background: '#c99a31ff'
            }
          })
            .png()
            .toBuffer(),
          left: 13,
          top: 5
        }
      ])
      .png()
      .toFile(source);

    const provider = new DeterministicProvider();

    for (const stylePreset of STYLE_PRESETS) {
      for (const animationMode of ANIMATION_MODES) {
        const plan = await provider.analyze({
          imagePath: source,
          targetWidth: 32,
          targetHeight: 32,
          paletteMax: 16,
          stylePreset,
          segmentationMode: 'auto-local',
          animationMode,
          outputName: `${stylePreset}-${animationMode}`
        });

        expect(plan.canvas).toMatchObject({
          width: 32,
          height: 32
        });
        expect(plan.layers.length).toBeGreaterThan(0);
        expect(plan.drawOps.length).toBeGreaterThan(0);
        expect(plan.frames?.length ?? 1).toBe(animationMode === 'topdown-walk-8' ? 8 : animationMode === 'single' ? 1 : 4);
      }
    }
  });
});

async function readFrameHashes(imagePath: string, frameWidth: number, frameHeight: number): Promise<string[]> {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frameCount = Math.floor(info.width / frameWidth);

  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const frame = Buffer.alloc(frameWidth * frameHeight * 4);

    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const sourceOffset = (y * info.width + frameIndex * frameWidth + x) * 4;
        const targetOffset = (y * frameWidth + x) * 4;

        frame[targetOffset] = data[sourceOffset] ?? 0;
        frame[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
        frame[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
        frame[targetOffset + 3] = data[sourceOffset + 3] ?? 0;
      }
    }

    return frame.toString('base64');
  });
}

async function readGreenFrameCenters(imagePath: string, frameWidth: number, frameHeight: number): Promise<Array<{ x: number; y: number } | null>> {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frameCount = Math.floor(info.width / frameWidth);

  return Array.from({ length: frameCount }, (_, frameIndex) => {
    let count = 0;
    let totalX = 0;
    let totalY = 0;

    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const offset = (y * info.width + frameIndex * frameWidth + x) * 4;
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        const alpha = data[offset + 3] ?? 0;

        if (alpha > 0 && green > 150 && red < 110 && blue < 150) {
          count += 1;
          totalX += x;
          totalY += y;
        }
      }
    }

    if (count === 0) return null;

    return {
      x: totalX / count,
      y: totalY / count
    };
  });
}
