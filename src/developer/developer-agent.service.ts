import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GithubService, FileChange } from './github.service';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

interface PendingPr {
  prNumber: number;
  prUrl: string;
  intent: string;
  remoteJid: string;
}

@Injectable()
export class DeveloperAgentService {
  private readonly logger = new Logger(DeveloperAgentService.name);
  private readonly pendingQuestions = new Map<string, (answer: string) => void>();
  private readonly pendingPrs = new Map<string, PendingPr>();
  private readonly anthropic: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly github: GithubService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY'),
    });
  }

  hasPendingQuestion(remoteJid: string): boolean {
    return this.pendingQuestions.has(remoteJid);
  }

  hasPendingPr(remoteJid: string): boolean {
    return this.pendingPrs.has(remoteJid);
  }

  getPendingPr(remoteJid: string): PendingPr | undefined {
    return this.pendingPrs.get(remoteJid);
  }

  resolveQuestion(remoteJid: string, answer: string): void {
    const resolve = this.pendingQuestions.get(remoteJid);
    if (resolve) {
      this.pendingQuestions.delete(remoteJid);
      resolve(answer);
    }
  }

  async mergePr(remoteJid: string): Promise<void> {
    const pr = this.pendingPrs.get(remoteJid);
    if (!pr) return;
    await this.github.mergePR(pr.prNumber);
    this.pendingPrs.delete(remoteJid);
  }

  async rerunWithFeedback(pr: PendingPr, feedback: string): Promise<void> {
    this.pendingPrs.delete(pr.remoteJid);
    await this.handleMissingFunction(
      pr.intent,
      `${pr.intent}\n\nFeedback de correção: ${feedback}`,
      pr.remoteJid,
      true,
    );
  }

  async handleMissingFunction(
    toolName: string,
    userIntent: string,
    remoteJid: string,
    isRerun = false,
  ): Promise<void> {
    this.logger.log(`Dev agent starting for tool: ${toolName}`);

    const writtenFiles = new Map<string, string>();
    // Developer agent always uses Claude regardless of AI_PROVIDER env var.
    // Uses the most capable model for code generation — haiku is too weak for this.
    const model = this.config.get('DEVELOPER_AGENT_MODEL') ?? 'claude-sonnet-4-6';

    const systemPrompt = `Você é um desenvolvedor NestJS especialista. Sua tarefa é implementar a ferramenta "${toolName}" no projeto de assistente financeiro WhatsApp.

O usuário pediu: "${userIntent}"

O projeto usa NestJS, TypeScript, TypeORM com SQLite (sql.js). As ferramentas existentes são: log_expense, log_saving, query_transactions, get_summary, todas definidas em src/agent/agent.service.ts.

Você deve:
1. Ler os arquivos relevantes do projeto para entender a estrutura existente
2. Implementar a nova tool seguindo os padrões existentes
3. Adicionar a tool na lista TOOLS do agent.service.ts
4. Adicionar o case correspondente no executeTool() do agent.service.ts
5. Se necessário, criar serviços/entidades adicionais
6. Usar run_tsc para verificar se há erros de compilação e corrigi-los
7. Se a implementação precisar de variáveis de ambiente novas (ex: API keys externas):
   a. Use ask_user para perguntar o valor ao usuário via WhatsApp
   b. Use update_env para gravar a variável no .env local com o valor fornecido
   c. Use write_file para atualizar .env.example com um placeholder (ex: your_xxx_here)
   d. Acesse o valor no código via ConfigService (NestJS)

Seja preciso e siga exatamente os padrões do projeto. Foque em: ${toolName}`;

    const tools: Anthropic.Tool[] = [
      {
        name: 'read_file',
        description: 'Read a file from the project. Path is relative to project root.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path from project root' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_files',
        description: 'List files in a directory. Path is relative to project root.',
        input_schema: {
          type: 'object' as const,
          properties: {
            dir: { type: 'string', description: 'Relative directory path' },
          },
          required: ['dir'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file. Path is relative to project root.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Relative path from project root' },
            content: { type: 'string', description: 'Full file content' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'run_tsc',
        description: 'Run TypeScript type checker (tsc --noEmit) and return output.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'ask_user',
        description: 'Send a question to the user via WhatsApp and wait for their reply.',
        input_schema: {
          type: 'object' as const,
          properties: {
            question: { type: 'string', description: 'The question to ask the user' },
          },
          required: ['question'],
        },
      },
      {
        name: 'update_env',
        description:
          'Add or update a variable in the .env file. Use this when the feature requires a new API key or secret that the user provided via ask_user.',
        input_schema: {
          type: 'object' as const,
          properties: {
            key: { type: 'string', description: 'Environment variable name, e.g. OPENAI_API_KEY' },
            value: { type: 'string', description: 'The value to set' },
          },
          required: ['key', 'value'],
        },
      },
    ];

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Implemente a ferramenta "${toolName}" conforme solicitado: ${userIntent}`,
      },
    ];

    // Agentic loop
    while (true) {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        break;
      }

      if (response.stop_reason !== 'tool_use') {
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;

        try {
          result = await this.executeTool(
            block.name,
            block.input as Record<string, string>,
            remoteJid,
            writtenFiles,
          );
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // Collect written files for PR
    if (writtenFiles.size === 0) {
      await this.sendWhatsApp(remoteJid, '⚠️ O agente não gerou nenhuma alteração de código.');
      return;
    }

    const branchName = `feat/auto-${toolName.replace(/_/g, '-')}-${Date.now()}`;
    const fileChanges: FileChange[] = [];

    for (const [filePath, content] of writtenFiles.entries()) {
      fileChanges.push({ path: filePath, content });
    }

    try {
      const pr = await this.github.createBranchAndPR(
        branchName,
        fileChanges,
        `feat: implementar ferramenta ${toolName}`,
        `## Ferramenta implementada automaticamente\n\nFerramenta: \`${toolName}\`\n\nSolicitação do usuário: ${userIntent}\n\n### Arquivos alterados\n${fileChanges.map((f) => `- \`${f.path}\``).join('\n')}`,
      );

      this.pendingPrs.set(remoteJid, {
        prNumber: pr.number,
        prUrl: pr.url,
        intent: toolName,
        remoteJid,
      });

      await this.sendWhatsApp(
        remoteJid,
        `✅ Implementação concluída! PR criado:\n${pr.url}\n\nResponda *aprovado* para fazer merge ou *recusado: [motivo]* para solicitar correções.`,
      );
    } catch (e) {
      this.logger.error('Failed to create PR', e);
      await this.sendWhatsApp(
        remoteJid,
        `❌ Implementação concluída mas falhou ao criar PR: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async executeTool(
    name: string,
    input: Record<string, string>,
    remoteJid: string,
    writtenFiles: Map<string, string>,
  ): Promise<string> {
    switch (name) {
      case 'read_file': {
        const fullPath = path.join(PROJECT_ROOT, input.path);
        if (!fullPath.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
        return fs.readFileSync(fullPath, 'utf-8');
      }

      case 'list_files': {
        const fullPath = path.join(PROJECT_ROOT, input.dir);
        if (!fullPath.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n');
      }

      case 'write_file': {
        const fullPath = path.join(PROJECT_ROOT, input.path);
        if (!fullPath.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, input.content, 'utf-8');
        writtenFiles.set(input.path, input.content);
        return `File written: ${input.path}`;
      }

      case 'run_tsc': {
        try {
          execSync('npx tsc --noEmit', { cwd: PROJECT_ROOT, timeout: 60000 });
          return 'TypeScript compilation: no errors';
        } catch (e: unknown) {
          const err = e as { stdout?: Buffer; stderr?: Buffer };
          return `TypeScript errors:\n${err.stdout?.toString() ?? err.stderr?.toString() ?? String(e)}`;
        }
      }

      case 'ask_user': {
        await this.sendWhatsApp(remoteJid, `🤖 (Pergunta do desenvolvedor)\n${input.question}`);
        return await new Promise<string>((resolve) => {
          this.pendingQuestions.set(remoteJid, resolve);
        });
      }

      case 'update_env': {
        const envPath = path.join(PROJECT_ROOT, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        const regex = new RegExp(`^${input.key}=.*$`, 'm');
        const line = `${input.key}=${input.value}`;
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, line);
        } else {
          envContent = envContent.trimEnd() + `\n${line}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf-8');
        return `Environment variable ${input.key} set in .env`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  async sendWhatsApp(remoteJid: string, text: string): Promise<void> {
    const url = this.config.get('EVOLUTION_API_URL');
    const apiKey = this.config.get('EVOLUTION_API_KEY');
    const instance = this.config.get('EVOLUTION_INSTANCE');

    if (!url || !apiKey || !instance) {
      this.logger.warn('EvolutionAPI not configured — skipping WhatsApp send');
      return;
    }

    try {
      await axios.post(
        `${url}/message/sendText/${instance}`,
        { number: remoteJid, text },
        { headers: { apikey: apiKey } },
      );
    } catch (err) {
      this.logger.error('Failed to send WhatsApp message', (err as Error)?.message);
    }
  }
}
