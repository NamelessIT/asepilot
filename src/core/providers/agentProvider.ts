import type { AgentProviderId, PixelPlan, PixelRequest } from '../types';

export interface AgentProvider {
  analyze(request: PixelRequest): Promise<PixelPlan>;
  revise(request: PixelRequest, previousPlan: PixelPlan, feedback: string): Promise<PixelPlan>;
}

export interface AgentProviderConfig {
  cliCommand?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  providerId: AgentProviderId;
}
