export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export type AiResponse =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[] };

export interface AiChatOptions {
  system: string;
  messages: AiMessage[];
  tools: ToolDefinition[];
}

export interface AiProvider {
  chat(options: AiChatOptions): Promise<AiResponse>;
}

export const AI_PROVIDER = Symbol('AiProvider');
