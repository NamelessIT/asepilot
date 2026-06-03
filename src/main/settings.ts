import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../core/types';
import type { AppSettings } from '../shared/api';

const DEFAULT_SETTINGS: AppSettings = {
  agentProvider: 'local',
  asepritePath: process.env.ASEPRITE_PATH ?? '',
  cliCommand:
    process.env.ASEPILOT_AGENT_COMMAND ??
    'codex exec --skip-git-repo-check --ephemeral --ignore-rules --sandbox read-only --image "{imagePath}" -',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiBaseUrl: process.env.ASEPILOT_OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  openAiModel: process.env.ASEPILOT_OPENAI_MODEL ?? 'gpt-4.1',
  outputRoot: ''
};

export async function readSettings(settingsPath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      ...DEFAULT_SETTINGS,
      agentProvider: parseAgentProvider(parsed.agentProvider),
      asepritePath: typeof parsed.asepritePath === 'string' ? parsed.asepritePath : DEFAULT_SETTINGS.asepritePath,
      cliCommand: typeof parsed.cliCommand === 'string' && parsed.cliCommand.trim() ? normalizeCliCommand(parsed.cliCommand) : DEFAULT_SETTINGS.cliCommand,
      openAiApiKey: typeof parsed.openAiApiKey === 'string' ? parsed.openAiApiKey : DEFAULT_SETTINGS.openAiApiKey,
      openAiBaseUrl: typeof parsed.openAiBaseUrl === 'string' ? parsed.openAiBaseUrl : DEFAULT_SETTINGS.openAiBaseUrl,
      openAiModel: typeof parsed.openAiModel === 'string' ? parsed.openAiModel : DEFAULT_SETTINGS.openAiModel,
      outputRoot: typeof parsed.outputRoot === 'string' ? parsed.outputRoot : DEFAULT_SETTINGS.outputRoot
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeSettingsFile(settingsPath: string, settings: AppSettings): Promise<AppSettings> {
  const nextSettings: AppSettings = {
    agentProvider: parseAgentProvider(settings.agentProvider),
    asepritePath: settings.asepritePath.trim(),
    cliCommand: normalizeCliCommand(settings.cliCommand.trim() || DEFAULT_SETTINGS.cliCommand),
    openAiApiKey: settings.openAiApiKey.trim(),
    openAiBaseUrl: settings.openAiBaseUrl.trim() || DEFAULT_SETTINGS.openAiBaseUrl,
    openAiModel: settings.openAiModel.trim() || DEFAULT_SETTINGS.openAiModel,
    outputRoot: settings.outputRoot.trim()
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf8');

  return nextSettings;
}

function parseAgentProvider(value: unknown): AgentProviderId {
  return typeof value === 'string' && AGENT_PROVIDER_IDS.includes(value as AgentProviderId) ? (value as AgentProviderId) : DEFAULT_SETTINGS.agentProvider;
}

function normalizeCliCommand(command: string): string {
  return command
    .replace(/\s+--ask-for-approval(?:=|\s+)never\b/g, '')
    .replace(/\s+-a(?:=|\s+)never\b/g, '')
    .replace(/\bcodex exec\b(?![\s\S]*\s--ephemeral\b)/, 'codex exec --ephemeral')
    .replace(/\bcodex exec\b(?![\s\S]*\s--ignore-rules\b)/, 'codex exec --ignore-rules')
    .replace(/\s+/g, ' ')
    .trim();
}
