import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AiChatOptions,
  AiMessage,
  AiProvider,
  AiResponse,
  ToolCall,
} from './ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.getOrThrow('OPENAI_API_KEY'),
    });
    this.model = this.config.get('OPENAI_MODEL', 'gpt-4o-mini');
  }

  async chat(options: AiChatOptions): Promise<AiResponse> {
    const { system, messages, tools } = options;

    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...this.toOpenAiMessages(messages),
    ];

    const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openAiMessages,
      tools: openAiTools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      const toolCalls: ToolCall[] = choice.message.tool_calls.map((tc) => {
        const fn = (tc as OpenAI.Chat.ChatCompletionMessageFunctionToolCall).function;
        return {
          id: tc.id,
          name: fn.name,
          input: JSON.parse(fn.arguments) as Record<string, unknown>,
        };
      });
      return { type: 'tool_calls', toolCalls };
    }

    return { type: 'text', text: choice.message.content ?? 'Done.' };
  }

  private toOpenAiMessages(
    messages: AiMessage[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      if ('toolCalls' in msg) {
        result.push({
          role: 'assistant',
          content: null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        });
      } else if (msg.role === 'tool') {
        // OpenAI needs one message per tool result
        for (const r of msg.results) {
          result.push({
            role: 'tool',
            tool_call_id: r.toolCallId,
            content: r.content,
          });
        }
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }
}
