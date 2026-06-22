import { Controller, Post, Body, HttpCode, Logger, OnModuleInit } from '@nestjs/common';
import { AgentService } from './agent.service';
import { DirectMessageDto, EvolutionWebhookDto } from './dto/incoming-message.dto';
import { ConfigService } from '@nestjs/config';
import { DeveloperAgentService } from '../developer/developer-agent.service';
import { PrReviewService } from '../developer/pr-review.service';
import axios from 'axios';

@Controller()
export class AgentController implements OnModuleInit {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agent: AgentService,
    private readonly config: ConfigService,
    private readonly developerAgent: DeveloperAgentService,
    private readonly prReview: PrReviewService,
  ) {}

  async onModuleInit() {
    const adminJid = this.config.get<string>('ADMIN_JID');
    if (!adminJid) return;
    const connected = await this.waitForWhatsAppConnection();
    if (connected) {
      await this.sendWhatsAppReply(adminJid, 'Agente iniciado').catch(() => undefined);
    }
  }

  // Polls Evolution API until WhatsApp is connected (state === "open").
  // On first disconnected check, fetches and logs the QR code URL.
  // Returns true when connected, false after timeout (2 min).
  private async waitForWhatsAppConnection(
    intervalMs = 5000,
    maxAttempts = 24,
  ): Promise<boolean> {
    const url = this.config.get<string>('EVOLUTION_API_URL');
    const apiKey = this.config.get<string>('EVOLUTION_API_KEY');
    const instance = this.config.get<string>('EVOLUTION_INSTANCE');

    if (!url || !apiKey || !instance) return false;

    let qrFetched = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await axios.get(
          `${url}/instance/connectionState/${instance}`,
          { headers: { apikey: apiKey } },
        );
        const state: string = data?.instance?.state ?? data?.state ?? '';
        this.logger.log(`WhatsApp connection state: ${state} (attempt ${attempt}/${maxAttempts})`);

        if (state === 'open') return true;

        // Not connected yet — fetch QR code once so user can scan
        if (!qrFetched) {
          qrFetched = true;
          await this.fetchAndLogQrCode(url, apiKey, instance);
        }
      } catch (e) {
        this.logger.warn(`Connection check failed (attempt ${attempt}/${maxAttempts}): ${(e as Error)?.message}`);
        // Instance might not exist yet — try to create QR
        if (!qrFetched) {
          qrFetched = true;
          await this.fetchAndLogQrCode(url, apiKey, instance);
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    this.logger.warn('WhatsApp not connected after 2 min — skipping "Agente iniciado"');
    return false;
  }

  private async fetchAndLogQrCode(url: string, apiKey: string, instance: string): Promise<void> {
    try {
      const { data } = await axios.get(
        `${url}/instance/connect/${instance}`,
        { headers: { apikey: apiKey } },
      );
      const code: string = data?.code ?? data?.qrcode?.code ?? data?.base64 ?? '';
      const base64: string = data?.base64 ?? data?.qrcode?.base64 ?? '';

      if (code && !code.startsWith('data:')) {
        this.logger.log(
          `\n\n📱 ESCANEIE O QR CODE ABAIXO:\nhttps://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(code)}&size=300x300\n`,
        );
      } else if (base64) {
        this.logger.log(
          `\n\n📱 QR CODE BASE64 — cole em https://base64.guru/converter/decode/image :\n${base64.substring(0, 100)}...\n`,
        );
      } else {
        this.logger.warn(`QR response received but format unexpected: ${JSON.stringify(data).substring(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(`Could not fetch QR code: ${(e as Error)?.message}`);
    }
  }

  // Direct test endpoint — POST /api/message  { "text": "I spent 20 on gas" }
  @Post('message')
  async handleDirectMessage(@Body() dto: DirectMessageDto) {
    const today = new Date().toISOString().split('T')[0];
    const reply = await this.agent.processMessage(dto.text, 'direct', today);
    return { reply };
  }

  // EvolutionAPI webhook — POST /api/webhook/evolution
  @Post('webhook/evolution')
  @HttpCode(200)
  async handleEvolutionWebhook(@Body() payload: EvolutionWebhookDto) {
    if (payload.event === 'qrcode.updated') {
      const base64 = payload.data?.qrcode?.base64 ?? payload.data?.base64;
      if (base64) {
        this.logger.log(`QR CODE URL: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(payload.data?.qrcode?.code ?? payload.data?.code ?? '')}&size=300x300`);
        this.logger.log(`QR BASE64 (copie e cole em https://base64.guru/converter/decode/image): ${base64.substring(0, 80)}...`);
      }
      return { ok: true };
    }

    // Only process inbound text messages
    if (payload.event !== 'messages.upsert') return { ok: true };
    if (payload.data?.key?.fromMe) return { ok: true };

    const text =
      payload.data?.message?.conversation ??
      payload.data?.message?.extendedTextMessage?.text;

    if (!text) return { ok: true };

    const remoteJid = payload.data.key.remoteJid;
    this.logger.log(`[${payload.instance}] ${remoteJid}: ${text}`);

    // Route to PR review / pending question handler if applicable
    if (this.prReview.hasPendingState(remoteJid)) {
      const reply = await this.prReview.handleMessage(remoteJid, text);
      if (reply) await this.sendWhatsAppReply(remoteJid, reply);
      return { ok: true };
    }

    const today = new Date().toISOString().split('T')[0];
    const reply = await this.agent.processMessage(text, remoteJid, today);

    // Handle missing function sentinel
    if (reply.startsWith('__MISSING_FUNCTION:')) {
      const toolName = reply.slice('__MISSING_FUNCTION:'.length);
      await this.sendWhatsAppReply(
        remoteJid,
        `⚙️ A função *${toolName}* ainda não existe. Estou implementando agora, aguarde...`,
      );
      this.developerAgent
        .handleMissingFunction(toolName, text, remoteJid)
        .catch((e) => this.logger.error('Developer agent error', e));
      return { ok: true };
    }

    await this.sendWhatsAppReply(remoteJid, reply);
    return { ok: true };
  }

  private async sendWhatsAppReply(remoteJid: string, text: string) {
    const url = this.config.get('EVOLUTION_API_URL');
    const apiKey = this.config.get('EVOLUTION_API_KEY');
    const instance = this.config.get('EVOLUTION_INSTANCE');

    if (!url || !apiKey || !instance) {
      this.logger.warn('EvolutionAPI not configured — skipping reply send');
      return;
    }

    try {
      await axios.post(
        `${url}/message/sendText/${instance}`,
        { number: remoteJid, text },
        { headers: { apikey: apiKey } },
      );
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `${err.message} — ${JSON.stringify(err.response?.data)}`
        : (err as Error)?.message;
      this.logger.error('Failed to send WhatsApp reply', detail);
    }
  }
}
