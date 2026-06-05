import { describe, expect, it } from 'vitest';
import { buildPixelPlanPrompt, parseAgentPlanOutput, requiresSemanticTopdown } from '../providers/agentJson';
import type { PixelRequest } from '../types';

const baseRequest: PixelRequest = {
  imagePath: 'reference.png',
  targetWidth: 64,
  targetHeight: 64,
  paletteMax: 16,
  stylePreset: 'top-down-character',
  segmentationMode: 'ai-model',
  animationMode: 'topdown-4dir',
  outputName: 'creature'
};

describe('buildPixelPlanPrompt', () => {
  it('requires semantic redraw instructions for top-down direction generation', () => {
    const prompt = buildPixelPlanPrompt(baseRequest);

    expect(requiresSemanticTopdown(baseRequest)).toBe(true);
    expect(prompt).toContain('Treat the reference as the DOWN-facing/front-facing sprite only');
    expect(prompt).toContain('Do not create direction frames by rotating, mirroring, shifting, or copying the down frame.');
    expect(prompt).toContain('UP must show the back view');
    expect(prompt).toContain('Hard budget: keep total drawOps under');
  });

  it('does not require semantic redraw instructions for ordinary single-frame output', () => {
    const prompt = buildPixelPlanPrompt({
      ...baseRequest,
      animationMode: 'single'
    });

    expect(
      requiresSemanticTopdown({
        ...baseRequest,
        animationMode: 'single'
      })
    ).toBe(false);
    expect(prompt).not.toContain('Do not create direction frames by rotating, mirroring, shifting, or copying the down frame.');
  });

  it('describes the RPG full four-direction frame order and optional animation template', () => {
    const prompt = buildPixelPlanPrompt({
      ...baseRequest,
      animationMode: 'topdown-rpg-full-4dir',
      animationTemplatePath: 'C:\\Assets\\Orc.aseprite'
    });

    expect(prompt).toContain('Total frame count must be 136.');
    expect(prompt).toContain('idle 1-6, walk 1-8, attack01 1-6, attack02 1-6, hurt 1-4, death 1-4');
    expect(prompt).toContain('Template path: C:\\Assets\\Orc.aseprite');
    expect(prompt).toContain('The reference image remains the identity source of truth.');
  });

  it('normalizes common agent draw op coordinate aliases before validation', () => {
    const plan = parseAgentPlanOutput(
      JSON.stringify({
        canvas: {
          width: 64,
          height: 64,
          transparent: true
        },
        palette: [
          {
            name: 'ink',
            hex: '102028'
          },
          {
            name: 'green',
            hex: '#32e875'
          }
        ],
        layers: [
          {
            name: 'Character Base',
            opacity: 255,
            visible: 'yes'
          },
          {
            name: 'Shadow',
            opacity: '50',
            visible: 'hidden'
          }
        ],
        frames: [
          {
            index: 1,
            durationMs: 120,
            label: 'Down'
          }
        ],
        animations: [
          {
            name: 'idle',
            from: 1,
            to: 1
          }
        ],
        drawOps: [
          {
            op: 'frame',
            index: 1
          },
          {
            op: 'layer',
            name: 'Character Base'
          },
          {
            op: 'fill_rect',
            layer: 'Character Base',
            x1: 10,
            y1: 12,
            x2: 14,
            y2: 15,
            color: '32e875'
          },
          {
            op: 'rectangle',
            layer: 'Character Base',
            x: 20,
            y: 24,
            w: 3,
            h: 4,
            color: '#102028'
          }
        ],
        artistNotes: ['test']
      })
    );

    expect(plan.palette.map((color) => color.hex)).toEqual(['#102028', '#32e875']);
    expect(plan.layers).toEqual([
      {
        name: 'Character Base',
        opacity: 1,
        visible: true
      },
      {
        name: 'Shadow',
        opacity: 0.5,
        visible: false
      }
    ]);
    expect(plan.drawOps[2]).toMatchObject({
      op: 'fillRect',
      x: 10,
      y: 12,
      width: 5,
      height: 4,
      color: '#32e875'
    });
    expect(plan.drawOps[3]).toMatchObject({
      op: 'rect',
      x: 20,
      y: 24,
      width: 3,
      height: 4
    });
  });
});
