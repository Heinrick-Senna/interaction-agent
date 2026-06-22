import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Armazena um contato telefônico associado a um usuário (owner = JID do dono).
 * phoneNumber deve ser o número no formato internacional sem símbolos, ex: 5511999999999.
 */
@Entity('phone_contacts')
export class PhoneContact {
  @PrimaryGeneratedColumn()
  id: number;

  /** JID do usuário dono do contato (remoteJid do WhatsApp) */
  @Column({ type: 'varchar' })
  owner: string;

  /** Nome amigável do contato */
  @Column({ type: 'varchar' })
  name: string;

  /**
   * Número no formato internacional sem caracteres especiais.
   * Ex: 5511999999999
   * O sufixo @s.whatsapp.net é adicionado dinamicamente ao enviar.
   */
  @Column({ type: 'varchar' })
  phoneNumber: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
