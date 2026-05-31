import type { PixelPlan, PixelRequest } from '../types';

export interface AgentProvider {
  analyze(request: PixelRequest): Promise<PixelPlan>;
  revise(request: PixelRequest, previousPlan: PixelPlan, feedback: string): Promise<PixelPlan>;
}

