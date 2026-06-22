import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { RemindersService } from '../reminders/reminders.service';
import { PhoneContactsService } from '../phone-contacts/phone-contacts.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  AI_PROVIDER,
  AiMessage,
  AiProvider,
  ToolDefinition,
  ToolResult,
} from '../ai/ai-provider.interface';
import { buildSystemPrompt } from './prompts/system.prompt';

const TOOLS: ToolDefinition[] = [
  {
    name: 'log_expense',
    description:
      'Log a money expense. Use when the user says they spent, paid, or bought something.',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'The amount spent (always positive).',
        },
        category: {
          type: 'string',
          description:
            'Category of the expense, e.g. gas, food, groceries, rent, health, entertainment, transport.',
        },
        description: {
          type: 'string',
          description: 'Short description of what was bought or paid for.',
        },
        method: {
          type: 'string',
          enum: ['dinheiro', 'cartão', 'débito', 'pix'],
          description: 'Payment method. Only include if the user mentions it.',
        },
        transaction_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) when the expense happened. Omit if not mentioned.',
        },
      },
      required: ['amount', 'category'],
    },
  },
  {
    name: 'log_saving',
    description:
      'Log a savings deposit. Use when the user says they saved, deposited, or put money aside.',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'The amount saved (always positive).',
        },
        description: {
          type: 'string',
          description:
            'Optional note about this saving, e.g. "emergency fund", "vacation fund".',
        },
        method: {
          type: 'string',
          enum: ['dinheiro', 'cartão', 'débito', 'pix'],
          description: 'Payment method. Only include if the user mentions it.',
        },
        transaction_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) when the saving happened. Omit if not mentioned.',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'query_transactions',
    description:
      'Query past expenses or savings. Use when the user asks how much they spent or saved, with optional filters by time period or category.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['expense', 'saving', 'all'],
          description: 'Filter by transaction type.',
        },
        start_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) — start of the period to query.',
        },
        end_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) — end of the period to query.',
        },
        category: {
          type: 'string',
          description:
            'Filter expenses by category (partial match). Leave empty to get all.',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'request_new_feature',
    description:
      'Call this when the user asks for something that cannot be done with the existing tools. This triggers the developer agent to implement the missing capability.',
    parameters: {
      type: 'object',
      properties: {
        feature_description: {
          type: 'string',
          description: 'Clear description of what the user wants to do.',
        },
      },
      required: ['feature_description'],
    },
  },
  {
    name: 'get_summary',
    description:
      'Get a financial summary for a time period: total expenses, total savings, and a breakdown by category.',
    parameters: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) — start of the period.',
        },
        end_date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD) — end of the period.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_reminders',
    description:
      'List all pending (not yet sent) reminders for the user. ' +
      'Use when the user asks "quais meus lembretes", "tenho algum lembrete", "mostre meus lembretes" or similar.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_reminder',
    description:
      'Set a reminder to notify the user at a specific date and time via WhatsApp. ' +
      'Use when the user says "me lembre", "me avise", "lembra de mim", "remind me" or similar. ' +
      'Resolve relative dates (amanhã, hoje, semana que vem) based on today\'s date.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'The reminder text to send to the user. Should be concise and clear, e.g. "Pagar aluguel".',
        },
        remind_at: {
          type: 'string',
          description:
            'ISO 8601 datetime (YYYY-MM-DDTHH:mm:ss) when the reminder should fire. ' +
            'Always include time — if the user does not specify, use 09:00:00. ' +
            'Resolve relative expressions: "amanhã meio dia" → next day at 12:00:00.',
        },
      },
      required: ['message', 'remind_at'],
    },
  },
  // ── Contatos telefônicos ────────────────────────────────────────────────────
  {
    name: 'manage_phone_contacts',
    description:
      'Manage the user\'s phone contact list. ' +
      'Use action="save" to add or update a contact (name + phone number). ' +
      'Use action="list" to show all saved contacts. ' +
      'Use action="delete" to remove a contact by ID. ' +
      'Triggers: "salvar contato", "adicionar contato", "guardar número", ' +
      '"listar contatos", "meus contatos", "quais meus contatos", ' +
      '"remover contato", "apagar contato".',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'list', 'delete'],
          description: 'Operation to perform on the contact list.',
        },
        name: {
          type: 'string',
          description: 'Contact\'s display name. Required for action="save".',
        },
        phone_number: {
          type: 'string',
          description:
            'Phone number in international format (digits only, e.g. 5511999999999). ' +
            'Required for action="save".',
        },
        contact_id: {
          type: 'number',
          description: 'Contact ID to delete. Required for action="delete".',
        },
      },
      required: ['action'],
    },
  },
  // ── Enviar mensagem para contato telefônico ─────────────────────────────────
  {
    name: 'send_whatsapp_message',
    description:
      'Send a WhatsApp text message to a phone contact saved in the user\'s contact list, ' +
      'or directly to a phone number provided by the user. ' +
      'Use when the user says "manda mensagem para", "envia mensagem para", ' +
      '"fala para", "avisa", "manda um zap para", "send a message to" or similar. ' +
      'If the user provides a name, look it up in the saved contacts first. ' +
      'If the user provides a number directly, use it. ' +
      'Always confirm the recipient and message content before sending.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: {
          type: 'string',
          description:
            'Name of the saved contact to send the message to. ' +
            'Provide either recipient_name (looked up in contacts) OR phone_number — not both.',
        },
        phone_number: {
          type: 'string',
          description:
            'Phone number in international format (digits only, e.g. 5511999999999). ' +
            'Used when the user provides a number directly, without a saved contact name.',
        },
        message: {
          type: 'string',
          description: 'The message text to send. Supports WhatsApp formatting (*bold*, _italic_).',
        },
      },
      required: ['message'],
    },
  },
];

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  // In-memory conversation history keyed by remoteJid
  private readonly sessions = new Map<string, AiMessage[]>();

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly transactions: TransactionsService,
    private readonly reminders: RemindersService,
    private readonly phoneContacts: PhoneContactsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async clearSession(remoteJid: string): Promise<void> {
    const contactId = await this.transactions.resolveContactId(remoteJid);
    this.sessions.delete(contactId);
  }

  async processMessage(userMessage: string, remoteJid: string, today: string): Promise<string> {
    const system = buildSystemPrompt(today);
    const contactId = await this.transactions.resolveContactId(remoteJid);

    if (!this.sessions.has(contactId)) {
      this.sessions.set(contactId, []);
    }
    const messages = this.sessions.get(contactId)!;
    messages.push({ role: 'user', content: userMessage });

    while (true) {
      const response = await this.ai.chat({ system, messages, tools: TOOLS });

      if (response.type === 'text') {
        messages.push({ role: 'assistant', content: response.text });
        return response.text;
      }

      const rawResults = await Promise.all(
        response.toolCalls.map(async (tc) => {
          const result = await this.executeTool(tc.name, tc.input, remoteJid);
          return { tc, result };
        }),
      );

      // Detect missing function — return sentinel immediately
      for (const { result } of rawResults) {
        const r = result as Record<string, unknown>;
        if (r?.__missing_function) {
          // name holds the feature_description (from request_new_feature) or the raw tool name
          return `__MISSING_FUNCTION:${r.name as string}`;
        }
      }

      const toolResults: ToolResult[] = rawResults.map(({ tc, result }) => ({
        toolCallId: tc.id,
        content: JSON.stringify(result),
      }));

      messages.push({ role: 'assistant', toolCalls: response.toolCalls });
      messages.push({ role: 'tool', results: toolResults });
    }
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    owner: string,
  ): Promise<unknown> {
    this.logger.debug(`Tool call: ${name} ${JSON.stringify(input)}`);

    // Defaults merged with model output — model only returns what it explicitly knows
    const defaults: Record<string, unknown> = {
      currency: 'BRL',
      owner,
      transaction_date: new Date().toISOString().split('T')[0],
    };

    switch (name) {
      case 'log_expense': {
        const payload = { ...defaults, ...input };
        const saved = await this.transactions.create({
          type: 'expense',
          amount: payload.amount as number,
          category: payload.category as string,
          description: payload.description as string | undefined,
          currency: payload.currency as string,
          method: payload.method as string | undefined,
          owner: payload.owner as string,
          transactionDate: payload.transaction_date as string,
        });
        return { success: true, id: saved.id };
      }

      case 'log_saving': {
        const payload = { ...defaults, ...input };
        const saved = await this.transactions.create({
          type: 'saving',
          amount: payload.amount as number,
          category: 'savings',
          description: payload.description as string | undefined,
          currency: payload.currency as string,
          method: payload.method as string | undefined,
          owner: payload.owner as string,
          transactionDate: payload.transaction_date as string,
        });
        return { success: true, id: saved.id };
      }

      case 'query_transactions': {
        const rows = await this.transactions.query({
          type: input.type as 'expense' | 'saving' | 'all',
          startDate: input.start_date as string | undefined,
          endDate: input.end_date as string | undefined,
          category: input.category as string | undefined,
        });
        return { transactions: rows, count: rows.length };
      }

      case 'get_summary': {
        const summary = await this.transactions.getSummary({
          startDate: input.start_date as string | undefined,
          endDate: input.end_date as string | undefined,
        });
        return summary;
      }

      case 'list_reminders': {
        const pending = await this.reminders.listPending(owner);
        return { reminders: pending, count: pending.length };
      }

      case 'set_reminder': {
        const reminder = await this.reminders.create({
          owner,
          message: input.message as string,
          remindAt: input.remind_at as string,
        });
        return {
          success: true,
          id: reminder.id,
          message: reminder.message,
          remindAt: reminder.remindAt,
        };
      }

      // ── Contatos telefônicos ──────────────────────────────────────────────
      case 'manage_phone_contacts': {
        const action = input.action as string;

        if (action === 'save') {
          const name = input.name as string | undefined;
          const phoneNumber = input.phone_number as string | undefined;

          if (!name || !phoneNumber) {
            return {
              success: false,
              error: 'name and phone_number are required for action="save".',
            };
          }

          const contact = await this.phoneContacts.upsert({ owner, name, phoneNumber });
          return {
            success: true,
            action: 'saved',
            contact: {
              id: contact.id,
              name: contact.name,
              phoneNumber: contact.phoneNumber,
            },
          };
        }

        if (action === 'list') {
          const contacts = await this.phoneContacts.listByOwner(owner);
          return {
            success: true,
            contacts,
            count: contacts.length,
          };
        }

        if (action === 'delete') {
          const contactId = input.contact_id as number | undefined;
          if (!contactId) {
            return {
              success: false,
              error: 'contact_id is required for action="delete".',
            };
          }
          const removed = await this.phoneContacts.remove(owner, contactId);
          return { success: removed, action: 'deleted', contact_id: contactId };
        }

        return { success: false, error: `Unknown action: ${action}` };
      }

      // ── Enviar mensagem WhatsApp ───────────────────────────────────────────
      case 'send_whatsapp_message': {
        const message = input.message as string;
        const recipientName = input.recipient_name as string | undefined;
        const rawPhone = input.phone_number as string | undefined;

        // Resolve destinatário: nome salvo tem prioridade sobre número avulso
        let targetJid: string | null = null;
        let resolvedName: string | null = null;

        if (recipientName) {
          const contact = await this.phoneContacts.findByName(owner, recipientName);
          if (!contact) {
            return {
              success: false,
              error: `Contato "${recipientName}" não encontrado na sua lista. Salve-o primeiro com manage_phone_contacts.`,
            };
          }
          targetJid = this.phoneContacts.toWhatsAppJid(contact.phoneNumber);
          resolvedName = contact.name;
        } else if (rawPhone) {
          targetJid = this.phoneContacts.toWhatsAppJid(rawPhone);
          resolvedName = rawPhone;
        } else {
          return {
            success: false,
            error: 'Informe recipient_name (contato salvo) ou phone_number para enviar a mensagem.',
          };
        }

        try {
          await this.whatsapp.sendText(targetJid, message);
          this.logger.log(`Mensagem enviada para ${resolvedName} (${targetJid})`);
          return {
            success: true,
            recipient: resolvedName,
            jid: targetJid,
            message,
          };
        } catch (err) {
          const detail = (err as Error)?.message ?? 'unknown error';
          this.logger.error(`Falha ao enviar para ${targetJid}: ${detail}`);
          return {
            success: false,
            error: `Não foi possível enviar a mensagem: ${detail}`,
            recipient: resolvedName,
            jid: targetJid,
          };
        }
      }

      case 'request_new_feature':
        return { __missing_function: true, name: input.feature_description as string };

      default:
        return { __missing_function: true, name };
    }
  }
}
