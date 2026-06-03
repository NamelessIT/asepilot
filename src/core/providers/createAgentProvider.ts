import { CliJsonProvider } from './cliJsonProvider';
import { DeterministicProvider } from './deterministicProvider';
import { OpenAICompatibleProvider } from './openAiCompatibleProvider';
import type { AgentProvider, AgentProviderConfig } from './agentProvider';

export function createAgentProvider(config: AgentProviderConfig): AgentProvider {
  switch (config.providerId) {
    case 'local':
      return new DeterministicProvider();
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        apiKey: config.openAiApiKey,
        baseUrl: config.openAiBaseUrl,
        model: config.openAiModel
      });
    case 'cli-json':
      return new CliJsonProvider({
        command: config.cliCommand
      });
  }
}
