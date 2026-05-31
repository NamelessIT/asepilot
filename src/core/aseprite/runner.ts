import { access } from 'node:fs/promises';
import { execa } from 'execa';
import type { AsepriteRunResult } from '../types';

interface RunAsepriteOptions {
  asepritePath?: string | null;
  scriptPath: string;
  cwd: string;
}

export async function runAsepriteScript(options: RunAsepriteOptions): Promise<AsepriteRunResult> {
  const asepritePath = options.asepritePath?.trim() || process.env.ASEPRITE_PATH?.trim();

  if (!asepritePath) {
    return {
      status: 'skipped',
      error: 'Aseprite path is not configured.'
    };
  }

  try {
    await access(asepritePath);
  } catch {
    return {
      status: 'failed',
      error: `Aseprite executable was not found at: ${asepritePath}`
    };
  }

  const args = ['--batch', '--script', options.scriptPath];
  const command = `${asepritePath} ${args.join(' ')}`;

  try {
    const result = await execa(asepritePath, args, {
      cwd: options.cwd,
      reject: false,
      timeout: 120_000
    });

    return {
      status: result.exitCode === 0 ? 'success' : 'failed',
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.exitCode === 0 ? undefined : `Aseprite exited with code ${result.exitCode}.`
    };
  } catch (error) {
    return {
      status: 'failed',
      command,
      error: error instanceof Error ? error.message : 'Unknown Aseprite execution error.'
    };
  }
}

