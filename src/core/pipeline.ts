import { access, writeFile } from 'node:fs/promises';
import { createProjectPaths } from './projects';
import { preprocessReferenceImage } from './imagePreprocessor';
import { renderPlanToPng } from './planRenderer';
import { runAsepriteScript } from './aseprite/runner';
import { generateAsepriteLua } from './lua/generateLua';
import { createAgentProvider } from './providers/createAgentProvider';
import { parsePixelPlan, parsePixelRequest } from './schema';
import { assertSemanticIdentityMatchesReference } from './semanticIdentityGuard';
import type { AgentProviderConfig } from './providers/agentProvider';
import type { PipelineResult, PixelRequest } from './types';

export interface RunPipelineOptions {
  request: PixelRequest;
  projectsRoot: string;
  agentProvider: AgentProviderConfig;
  asepritePath?: string | null;
  overwrite?: boolean;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const request = parsePixelRequest(options.request);
  const paths = await createProjectPaths(options.projectsRoot, request);

  if (!options.overwrite) {
    await assertDoesNotExist(paths.asepriteFile);
    await assertDoesNotExist(paths.asepritePng);
  }

  await preprocessReferenceImage(request.imagePath, paths);

  const provider = createAgentProvider(options.agentProvider);
  const plan = parsePixelPlan(
    await provider.analyze({
      ...request,
      imagePath: paths.sourceImage
    })
  );
  await assertSemanticIdentityMatchesReference(request, paths.sourceImage, plan);
  const lua = generateAsepriteLua(plan, {
    asepriteFile: paths.asepriteFile,
    pngFile: paths.asepritePng
  });

  await writeFile(paths.pixelPlan, JSON.stringify(plan, null, 2), 'utf8');
  await writeFile(paths.luaScript, lua, 'utf8');
  await renderPlanToPng(plan, paths.fallbackPng);

  const aseprite = await runAsepriteScript({
    asepritePath: options.asepritePath,
    scriptPath: paths.luaScript,
    cwd: paths.root
  });

  return {
    projectId: paths.projectId,
    projectRoot: paths.root,
    sourceImage: paths.sourceImage,
    previewImage: paths.previewImage,
    paletteDraft: paths.paletteDraft,
    pixelPlan: paths.pixelPlan,
    luaScript: paths.luaScript,
    previewPng: paths.fallbackPng,
    asepriteFile: paths.asepriteFile,
    asepritePng: paths.asepritePng,
    aseprite,
    plan
  };
}

async function assertDoesNotExist(filePath: string): Promise<void> {
  try {
    await access(filePath);
    throw new Error(`Refusing to overwrite existing export: ${filePath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to overwrite')) {
      throw error;
    }
  }
}
