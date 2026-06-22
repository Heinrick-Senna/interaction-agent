import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Serviço centralizado para enviar mensagens via Evolution API.
 * Usado pelo AgentService, RemindersScheduler e qualquer outra feature
 * que precise mandar texto para um JID do WhatsApp.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Envia uma mensagem de texto para o JID informado.
   * @param remoteJid  JID do destinatário (ex: "5511999999999@s.whatsapp.net")
   * @param text       Texto da mensagem (suporta *negrito*, _itálico_)
   * @throws           Propaga o erro do axios se a API retornar falha
   */
  async sendText(remoteJid: string, text: string): Promise<void> {
    const url = this.config.get<string>('EVOLUTION_API_URL');
    const apiKey = this.config.get<string>('EVOLUTION_API_KEY');
    const instance = this.config.get<string>('EVOLUTION_INSTANCE');

    if (!url || !apiKey || !instance) {
      this.logger.warn(
        'EvolutionAPI não configurada — mensagem não enviada via WhatsApp',
      );
      this.logger.log(`[WHATSAPP] Para ${remoteJid}: ${text}`);
      return;
    }

    try {
      await axios.post(
        `${url}/message/sendText/${instance}`,
        { number: remoteJid, text },
        { headers: { apikey: apiKey } },
      );
      this.logger.debug(`Mensagem enviada para ${remoteJid}`);
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `${err.message} — ${JSON.stringify(err.response?.data)}`
        : (err as Error)?.message;
      this.logger.error(`Falha ao enviar mensagem para ${remoteJid}: ${detail}`);
      throw err;
    }
  }
}
