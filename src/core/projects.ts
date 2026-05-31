import { mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { sanitizeOutputName } from './schema';
import type { PixelRequest, ProjectPaths } from './types';

export async function createProjectPaths(projectsRoot: string, request: PixelRequest): Promise<ProjectPaths> {
  const projectId = createProjectId(request.outputName);
  const root = join(projectsRoot, projectId);
  const inputDir = join(root, 'input');
  const analysisDir = join(root, 'analysis');
  const plansDir = join(root, 'plans');
  const scriptsDir = join(root, 'scripts');
  const exportsDir = join(root, 'exports');
  const sourceExtension = extname(request.imagePath) || '.png';
  const outputName = sanitizeOutputName(request.outputName);

  await Promise.all([inputDir, analysisDir, plansDir, scriptsDir, exportsDir].map((directory) => mkdir(directory, { recursive: true })));

  return {
    projectId,
    root,
    inputDir,
    analysisDir,
    plansDir,
    scriptsDir,
    exportsDir,
    sourceImage: join(inputDir, `reference${sourceExtension}`),
    previewImage: join(analysisDir, 'reference-preview.png'),
    paletteDraft: join(analysisDir, 'palette-draft.json'),
    pixelPlan: join(plansDir, 'pixel-plan.json'),
    luaScript: join(scriptsDir, 'render.lua'),
    fallbackPng: join(exportsDir, 'preview.png'),
    asepriteFile: join(exportsDir, `${outputName}.aseprite`),
    asepritePng: join(exportsDir, `${outputName}.png`)
  };
}

function createProjectId(outputName: string): string {
  const safeName = sanitizeOutputName(outputName).toLowerCase();
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${timestamp}-${safeName || basename(outputName)}`;
}

