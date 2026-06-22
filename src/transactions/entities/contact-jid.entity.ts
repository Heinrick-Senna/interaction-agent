import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

// Maps a WhatsApp JID (phone or group) to a shared Contact (conversation context).
// Multiple JIDs can point to the same contactId to share history.
@Entity('contact_jids')
export class ContactJid {
  @PrimaryColumn({ type: 'varchar' })
  jid: string;

  @Column({ type: 'varchar' })
  contactId: string;

  @CreateDateColumn()
  createdAt: Date;
}
