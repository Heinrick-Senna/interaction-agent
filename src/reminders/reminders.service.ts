import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Reminder } from './entities/reminder.entity';

export interface CreateReminderDto {
  owner: string;
  message: string;
  remindAt: string; // ISO 8601 datetime string
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(Reminder)
    private readonly repo: Repository<Reminder>,
  ) {}

  /** Cria um novo lembrete */
  async create(dto: CreateReminderDto): Promise<Reminder> {
    const reminder = this.repo.create({
      owner: dto.owner,
      message: dto.message,
      remindAt: dto.remindAt,
      sent: false,
    });
    return this.repo.save(reminder);
  }

  /**
   * Retorna todos os lembretes pendentes cujo remindAt <= agora
   * e ainda não foram enviados.
   */
  async findDue(): Promise<Reminder[]> {
    const now = new Date().toISOString();
    return this.repo.find({
      where: {
        sent: false,
        remindAt: LessThanOrEqual(now),
      },
    });
  }

  /** Marca um lembrete como enviado */
  async markSent(id: number): Promise<void> {
    await this.repo.update(id, { sent: true });
  }

  /** Lista todos os lembretes futuros (não enviados) de um usuário */
  async listPending(owner: string): Promise<Reminder[]> {
    const now = new Date().toISOString();
    const all = await this.repo.find({ where: { owner, sent: false } });
    return all.filter((r) => r.remindAt > now);
  }
}
