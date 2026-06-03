import { buildPixelPlanPrompt, imageToDataUrl, parseAgentPlanOutput } from './agentJson';
import type { AgentProvider } from './agentProvider';
import type { PixelPlan, PixelRequest } from '../types';

interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAICompatibleProvider implements AgentProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (options.baseUrl?.trim() || process.env.ASEPILOT_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = options.model?.trim() || process.env.ASEPILOT_OPENAI_MODEL || 'gpt-4.1';
  }

  async analyze(request: PixelRequest): Promise<PixelPlan> {
    if (!this.apiKey) {
      throw new Error('OpenAI-compatible provider is selected but no API key is configured.');
    }

    const imageUrl = await imageToDataUrl(request.imagePath);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        response_format: {
          type: 'json_object'
        },
        messages: [
          {
            role: 'system',
            content: 'You are AsePilot, a constrained pixel-art planning agent. Output valid PixelPlan JSON only.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildPixelPlanPrompt(request)
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ]
      })
    });
    const payload = (await response.json()) as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI-compatible provider failed with HTTP ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI-compatible provider returned no plan content.');
    }

    return parseAgentPlanOutput(content);
  }

  async revise(request: PixelRequest, previousPlan: PixelPlan, feedback: string): Promise<PixelPlan> {
    if (!this.apiKey) {
      throw new Error('OpenAI-compatible provider is selected but no API key is configured.');
    }

    const imageUrl = await imageToDataUrl(request.imagePath);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        response_format: {
          type: 'json_object'
        },
        messages: [
          {
            role: 'system',
            content: 'You revise constrained AsePilot PixelPlan JSON. Output valid JSON only.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildPixelPlanPrompt(request, `Revise this previous plan using feedback: ${feedback}\nPrevious plan JSON: ${JSON.stringify(previousPlan)}`)
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ]
      })
    });
    const payload = (await response.json()) as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI-compatible provider failed with HTTP ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI-compatible provider returned no revised plan content.');
    }

    return parseAgentPlanOutput(content);
  }
}
