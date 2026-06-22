import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('reminders')
export class Reminder {
  @PrimaryGeneratedColumn()
  id: number;

  /** WhatsApp JID do usuário (ex: 5511999999999@s.whatsapp.net) */
  @Column({ type: 'varchar' })
  owner: string;

  /** Texto do lembrete a ser enviado */
  @Column({ type: 'varchar' })
  message: string;

  /** Data e hora ISO 8601 para disparar o lembrete (ex: 2025-07-10T12:00:00) */
  @Column({ type: 'varchar' })
  remindAt: string;

  /** Se o lembrete já foi enviado */
  @Column({ type: 'boolean', default: false })
  sent: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
