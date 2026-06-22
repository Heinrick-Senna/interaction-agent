import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RemindersService } from './reminders.service';

/**
 * Verifica lembretes pendentes a cada minuto e envia a mensagem via WhatsApp.
 * Usa setInterval nativo — sem dependência de @nestjs/schedule.
 */
@Injectable()
export class RemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersScheduler.name);
  private intervalRef: NodeJS.Timeout | null = null;

  /** Intervalo de verificação: 60 segundos */
  private readonly INTERVAL_MS = 60_000;

  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.logger.log('RemindersScheduler iniciado — verificando a cada 60 s');
    // Primeira verificação imediata ao iniciar
    void this.checkReminders();
    this.intervalRef = setInterval(() => void this.checkReminders(), this.INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async checkReminders(): Promise<void> {
    try {
      const due = await this.reminders.findDue();
      if (due.length === 0) return;

      this.logger.log(`Disparando ${due.length} lembrete(s)...`);

      for (const reminder of due) {
        try {
          await this.sendWhatsAppMessage(
            reminder.owner,
            `🔔 *Lembrete:* ${reminder.message}`,
          );
          await this.reminders.markSent(reminder.id);
          this.logger.log(`Lembrete #${reminder.id} enviado para ${reminder.owner}`);
        } catch (err) {
          this.logger.error(
            `Falha ao enviar lembrete #${reminder.id}: ${(err as Error)?.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Erro ao verificar lembretes: ${(err as Error)?.message}`);
    }
  }

  private async sendWhatsAppMessage(remoteJid: string, text: string): Promise<void> {
    const url = this.config.get<string>('EVOLUTION_API_URL');
    const apiKey = this.config.get<string>('EVOLUTION_API_KEY');
    const instance = this.config.get<string>('EVOLUTION_INSTANCE');

    if (!url || !apiKey || !instance) {
      this.logger.warn('EvolutionAPI não configurada — lembrete não enviado via WhatsApp');
      this.logger.log(`[REMINDER] Para ${remoteJid}: ${text}`);
      return;
    }

    await axios.post(
      `${url}/message/sendText/${instance}`,
      { number: remoteJid, text },
      { headers: { apikey: apiKey } },
    );
  }
}
