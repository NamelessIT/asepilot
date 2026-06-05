import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaCommand } from 'execa';
import { buildPixelPlanPrompt, parseAgentPlanOutput, requiresSemanticTopdown } from './agentJson';
import { DeterministicProvider } from './deterministicProvider';
import { extractReferenceIdentityPalette } from '../semanticIdentityGuard';
import type { AgentProvider } from './agentProvider';
import type { PixelPlan, PixelRequest } from '../types';

interface CliJsonProviderOptions {
  command?: string;
}

export class CliJsonProvider implements AgentProvider {
  private readonly command: string;

  constructor(options: CliJsonProviderOptions) {
    this.command = options.command?.trim() || process.env.ASEPILOT_AGENT_COMMAND || '';
  }

  async analyze(request: PixelRequest): Promise<PixelPlan> {
    return this.runCli(await buildCliPrompt(request), request);
  }

  async revise(request: PixelRequest, previousPlan: PixelPlan, feedback: string): Promise<PixelPlan> {
    const prompt = await buildCliPrompt(request);

    return this.runCli(
      [
        prompt,
        '',
        `Feedback: ${feedback}`,
        '',
        'Previous plan JSON:',
        JSON.stringify(previousPlan)
      ].join('\n'),
      request
    );
  }

  private async runCli(prompt: string, request: PixelRequest): Promise<PixelPlan> {
    if (!this.command) {
      throw new Error('CLI JSON provider is selected but no command is configured.');
    }

    const outputDirectory = await mkdtemp(join(tmpdir(), 'asepilot-agent-'));
    const lastMessagePath = join(outputDirectory, 'last-message.json');
    const command = await buildCommand({
      baseCommand: this.command,
      lastMessagePath,
      outputDirectory,
      request
    });

    try {
      const result = await execaCommand(command, {
        cwd: dirname(request.imagePath),
        input: prompt,
        maxBuffer: 1024 * 1024 * 16,
        timeout: agentTimeoutMs(request)
      });
      const finalOutput = await readLastMessage(lastMessagePath, result.stdout);

      return parseAgentPlanOutput(finalOutput);
    } catch (error) {
      return await this.fallbackToLocal(request, error);
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  }

  private async fallbackToLocal(request: PixelRequest, error: unknown): Promise<PixelPlan> {
    const message = formatAgentError(error);

    if (requiresSemanticTopdown(request)) {
      throw new Error(
        [
          'CLI JSON agent could not finish semantic top-down direction generation.',
          'Local fallback is disabled here because it would only rotate/transform the source instead of redrawing left/right/up.',
          'Try again, use OpenAI-compatible API, reduce canvas size, or start dev with ASEPILOT_SEMANTIC_AGENT_TIMEOUT_MS=600000.',
          message.slice(0, 220)
        ].join(' ')
      );
    }

    const fallbackRequest: PixelRequest = {
      ...request,
      segmentationMode: request.segmentationMode === 'ai-model' ? 'auto-local' : request.segmentationMode
    };
    const provider = new DeterministicProvider();
    const plan = await provider.analyze(fallbackRequest);

    return {
      ...plan,
      artistNotes: [
        ...plan.artistNotes.slice(0, 16),
        `CLI JSON agent failed or timed out; local fallback was used. ${message.slice(0, 180)}`
      ]
    };
  }
}

async function buildCommand({
  baseCommand,
  lastMessagePath,
  outputDirectory,
  request
}: {
  baseCommand: string;
  lastMessagePath: string;
  outputDirectory: string;
  request: PixelRequest;
}): Promise<string> {
  let command = injectCodexOutputFile(interpolateCommand(normalizeCodexExecCommand(baseCommand), request), lastMessagePath);

  if (process.env.ASEPILOT_CODEX_OUTPUT_SCHEMA === '1') {
    const schemaPath = join(outputDirectory, 'pixel-plan.schema.json');
    await writeFile(schemaPath, JSON.stringify(pixelPlanOutputSchema()), 'utf8');
    command = injectCodexOutputSchema(command, schemaPath);
  }

  return command;
}

function formatAgentError(error: unknown): string {
  if (isExecaLikeError(error)) {
    return [error.message, error.stderr, error.stdout].filter(Boolean).join(' ');
  }

  return error instanceof Error ? error.message : String(error);
}

function isExecaLikeError(error: unknown): error is { message: string; stderr?: string; stdout?: string } {
  return typeof error === 'object' && error !== null && 'message' in error;
}

function normalizeCodexExecCommand(command: string): string {
  return command
    .replace(/\s+--ask-for-approval(?:=|\s+)never\b/g, '')
    .replace(/\s+-a(?:=|\s+)never\b/g, '')
    .replace(/\bcodex exec\b(?![\s\S]*\s--ephemeral\b)/, 'codex exec --ephemeral')
    .replace(/\bcodex exec\b(?![\s\S]*\s--ignore-rules\b)/, 'codex exec --ignore-rules')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readLastMessage(lastMessagePath: string, stdout: string): Promise<string> {
  try {
    const output = await readFile(lastMessagePath, 'utf8');
    if (output.trim()) return output;
  } catch {
    // Fall back to stdout when Codex did not write the last-message file.
  }

  return stdout;
}

function injectCodexOutputFile(command: string, lastMessagePath: string): string {
  if (!/\bcodex\s+exec\b/.test(command) || command.includes('--output-last-message')) {
    return command;
  }

  const option = ` --output-last-message ${quoteCommandArg(lastMessagePath)}`;

  return /\s-\s*$/.test(command) ? command.replace(/\s-\s*$/, `${option} -`) : `${command}${option}`;
}

function injectCodexOutputSchema(command: string, schemaPath: string): string {
  if (!/\bcodex\s+exec\b/.test(command) || command.includes('--output-schema')) {
    return command;
  }

  const option = ` --output-schema ${quoteCommandArg(schemaPath)}`;

  return /\s-\s*$/.test(command) ? command.replace(/\s-\s*$/, `${option} -`) : `${command}${option}`;
}

function agentTimeoutMs(request: PixelRequest): number {
  const semanticTimeout = Number.parseInt(process.env.ASEPILOT_SEMANTIC_AGENT_TIMEOUT_MS ?? '', 10);
  if (requiresSemanticTopdown(request) && Number.isFinite(semanticTimeout) && semanticTimeout >= 60_000) {
    return semanticTimeout;
  }

  const parsed = Number.parseInt(process.env.ASEPILOT_AGENT_TIMEOUT_MS ?? '', 10);

  if (Number.isFinite(parsed) && parsed >= 10_000) {
    return parsed;
  }

  return requiresSemanticTopdown(request) ? 300_000 : 90_000;
}

function interpolateCommand(command: string, request: PixelRequest): string {
  let nextCommand = command;

  nextCommand = replaceTemplateValue(nextCommand, 'imagePath', request.imagePath);
  nextCommand = replaceTemplateValue(nextCommand, 'animationTemplatePath', request.animationTemplatePath ?? '');
  nextCommand = replaceTemplateValue(nextCommand, 'imageDir', dirname(request.imagePath));
  nextCommand = replaceTemplateValue(nextCommand, 'outputName', request.outputName);
  nextCommand = replaceTemplateValue(nextCommand, 'targetWidth', String(request.targetWidth), false);
  nextCommand = replaceTemplateValue(nextCommand, 'targetHeight', String(request.targetHeight), false);
  nextCommand = replaceTemplateValue(nextCommand, 'stylePreset', request.stylePreset);
  nextCommand = replaceTemplateValue(nextCommand, 'animationMode', request.animationMode);

  return appendCodexTemplateImage(nextCommand, request);
}

function replaceTemplateValue(command: string, key: string, value: string, quote = true): string {
  const placeholder = `{${key}}`;
  const replacement = quote ? quoteCommandArg(value) : value;

  return command
    .replaceAll(`"${placeholder}"`, replacement)
    .replaceAll(`'${placeholder}'`, replacement)
    .replaceAll(placeholder, replacement);
}

function quoteCommandArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function buildCliPrompt(request: PixelRequest): Promise<string> {
  const referenceStyle = await buildReferenceStyleInstruction(request);

  return [
    buildPixelPlanPrompt(request),
    referenceStyle,
    '',
    `Reference image path: ${request.imagePath}`,
    '',
    request.animationTemplatePath ? `Animation template path: ${request.animationTemplatePath}` : '',
    'The reference image is attached to this Codex invocation with --image.',
    request.animationTemplatePath && isImageFile(request.animationTemplatePath)
      ? 'The animation template image is also attached to this Codex invocation with --image.'
      : '',
    request.animationTemplatePath && !isImageFile(request.animationTemplatePath)
      ? 'The animation template is a non-image file path. If you cannot inspect it, still follow the requested animation frame order exactly.'
      : '',
    'Do not run commands to inspect files. Do not inspect the AsePilot repository.',
    requiresSemanticTopdown(request)
      ? 'This semantic turnaround may be approximate. Prefer a compact readable sprite over exhaustive pixel-perfect detail.'
      : '',
    'Return only PixelPlan JSON on stdout.'
  ]
    .filter(Boolean)
    .join('\n');
}

function appendCodexTemplateImage(command: string, request: PixelRequest): string {
  const templatePath = request.animationTemplatePath?.trim();
  if (!templatePath || !isImageFile(templatePath) || !/\bcodex\s+exec\b/.test(command) || command.includes(quoteCommandArg(templatePath))) {
    return command;
  }

  const option = ` --image ${quoteCommandArg(templatePath)}`;

  return /\s-\s*$/.test(command) ? command.replace(/\s-\s*$/, `${option} -`) : `${command}${option}`;
}

function isImageFile(filePath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(filePath).toLowerCase());
}

async function buildReferenceStyleInstruction(request: PixelRequest): Promise<string> {
  if (!requiresSemanticTopdown(request)) return '';

  const palette = await extractReferenceIdentityPalette(request.imagePath, request.targetWidth, request.targetHeight);
  if (palette.all.length === 0) return '';

  return [
    'Reference identity lock:',
    `- Subject/creature colors, in priority order: ${palette.subject.join(', ')}.`,
    `- Distinctive subject accent colors that must remain visible in drawOps: ${palette.subjectAccents.join(', ') || palette.subject.slice(0, 3).join(', ')}.`,
    `- Background colors: ${palette.background.join(', ') || 'none detected'}. Do not use background colors as the creature shell/body replacement.`,
    '- Use subject hue families as the main creature palette. Do not introduce unrelated purple, yellow, white, cyan, pastel, or brown body colors unless they are visible on the subject itself.',
    '- Frame Down must look like the attached reference sprite at the requested size, not like a redesigned icon.',
    '- Other directions may be approximate, but they must clearly read as the same creature/object using the same dark/light color placement and distinctive appendages.'
  ].join('\n');
}

function pixelPlanOutputSchema(): Record<string, unknown> {
  const color = {
    type: 'string',
    pattern: '^#[0-9a-fA-F]{6}$'
  };
  const nonNegativeInt = {
    type: 'integer',
    minimum: 0
  };
  const positiveInt = {
    type: 'integer',
    minimum: 1
  };
  const layerName = {
    type: 'string',
    minLength: 1,
    maxLength: 64
  };
  const layerProperty = {
    layer: layerName
  };
  const colorProperty = {
    color
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['canvas', 'palette', 'layers', 'frames', 'animations', 'drawOps', 'artistNotes'],
    properties: {
      canvas: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height', 'transparent'],
        properties: {
          width: positiveInt,
          height: positiveInt,
          transparent: {
            type: 'boolean'
          }
        }
      },
      palette: {
        type: 'array',
        minItems: 1,
        maxItems: 64,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'hex'],
          properties: {
            name: layerName,
            hex: color
          }
        }
      },
      layers: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: layerName,
            opacity: {
              type: 'number',
              minimum: 0,
              maximum: 1
            },
            visible: {
              type: 'boolean'
            }
          }
        }
      },
      frames: {
        type: 'array',
        minItems: 1,
        maxItems: 160,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'durationMs', 'label'],
          properties: {
            index: positiveInt,
            durationMs: {
              type: 'integer',
              minimum: 20,
              maximum: 5000
            },
            label: layerName
          }
        }
      },
      animations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'from', 'to'],
          properties: {
            name: layerName,
            from: positiveInt,
            to: positiveInt,
            direction: layerName
          }
        }
      },
      drawOps: {
        type: 'array',
        items: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'name'],
              properties: {
                op: {
                  const: 'layer'
                },
                name: layerName
              }
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'index'],
              properties: {
                op: {
                  const: 'frame'
                },
                index: positiveInt
              }
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'x', 'y', 'color'],
              properties: {
                ...layerProperty,
                ...colorProperty,
                op: {
                  const: 'setPixel'
                },
                x: nonNegativeInt,
                y: nonNegativeInt
              }
            },
            boxDrawOpSchema('fillRect', layerProperty, colorProperty, nonNegativeInt, positiveInt),
            boxDrawOpSchema('rect', layerProperty, colorProperty, nonNegativeInt, positiveInt),
            boxDrawOpSchema('ellipse', layerProperty, colorProperty, nonNegativeInt, positiveInt, {
              fill: {
                type: 'boolean'
              }
            }),
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'x1', 'y1', 'x2', 'y2', 'color'],
              properties: {
                ...layerProperty,
                ...colorProperty,
                op: {
                  const: 'line'
                },
                x1: nonNegativeInt,
                y1: nonNegativeInt,
                x2: nonNegativeInt,
                y2: nonNegativeInt
              }
            }
          ]
        }
      },
      artistNotes: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 280
        }
      }
    }
  };
}

function boxDrawOpSchema(
  opName: string,
  layerProperty: Record<string, unknown>,
  colorProperty: Record<string, unknown>,
  nonNegativeInt: Record<string, unknown>,
  positiveInt: Record<string, unknown>,
  extraProperties: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'x', 'y', 'width', 'height', 'color'],
    properties: {
      ...layerProperty,
      ...colorProperty,
      ...extraProperties,
      op: {
        const: opName
      },
      x: nonNegativeInt,
      y: nonNegativeInt,
      width: positiveInt,
      height: positiveInt
    }
  };
}
