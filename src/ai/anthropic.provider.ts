import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiChatOptions,
  AiMessage,
  AiProvider,
  AiResponse,
  ToolCall,
} from './ai-provider.interface';

@Injectable()
export class AnthropicProvider implements AiProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow('ANTHROPIC_API_KEY'),
    });
    this.model = this.config.get('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
  }

  async chat(options: AiChatOptions): Promise<AiResponse> {
    const { system, messages, tools } = options;

    const anthropicMessages = messages.map(this.toAnthropicMessage);
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools: anthropicTools,
      messages: anthropicMessages,
    });

    if (response.stop_reason === 'tool_use') {
      const toolCalls: ToolCall[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));
      return { type: 'tool_calls', toolCalls };
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return { type: 'text', text: textBlock?.text ?? 'Done.' };
  }

  private toAnthropicMessage(msg: AiMessage): Anthropic.MessageParam {
    if ('toolCalls' in msg) {
      return {
        role: 'assistant',
        content: msg.toolCalls.map(
          (tc): Anthropic.ToolUseBlock => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          }),
        ),
      };
    }

    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: msg.results.map(
          (r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.toolCallId,
            content: r.content,
          }),
        ),
      };
    }

    return { role: msg.role, content: msg.content };
  }
}
