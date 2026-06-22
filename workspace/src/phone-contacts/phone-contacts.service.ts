import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhoneContact } from './entities/phone-contact.entity';

export interface CreatePhoneContactDto {
  owner: string;
  name: string;
  phoneNumber: string;
}

export interface PhoneContactResult {
  id: number;
  name: string;
  phoneNumber: string;
  createdAt: Date;
}

@Injectable()
export class PhoneContactsService {
  private readonly logger = new Logger(PhoneContactsService.name);

  constructor(
    @InjectRepository(PhoneContact)
    private readonly repo: Repository<PhoneContact>,
  ) {}

  /** Salva um novo contato. Se já existir (mesmo owner + phoneNumber), atualiza o nome. */
  async upsert(dto: CreatePhoneContactDto): Promise<PhoneContactResult> {
    const normalized = this.normalizeNumber(dto.phoneNumber);

    const existing = await this.repo.findOne({
      where: { owner: dto.owner, phoneNumber: normalized },
    });

    if (existing) {
      existing.name = dto.name;
      const saved = await this.repo.save(existing);
      return this.toResult(saved);
    }

    const contact = this.repo.create({
      owner: dto.owner,
      name: dto.name,
      phoneNumber: normalized,
    });
    const saved = await this.repo.save(contact);
    return this.toResult(saved);
  }

  /** Lista todos os contatos de um usuário */
  async listByOwner(owner: string): Promise<PhoneContactResult[]> {
    const contacts = await this.repo.find({
      where: { owner },
      order: { name: 'ASC' },
    });
    return contacts.map(this.toResult);
  }

  /**
   * Busca um contato pelo nome (correspondência parcial, case-insensitive via LIKE).
   * Retorna o primeiro match.
   */
  async findByName(owner: string, name: string): Promise<PhoneContactResult | null> {
    const all = await this.repo.find({ where: { owner } });
    const lower = name.toLowerCase();
    const found = all.find((c) => c.name.toLowerCase().includes(lower));
    return found ? this.toResult(found) : null;
  }

  /** Remove um contato pelo ID */
  async remove(owner: string, id: number): Promise<boolean> {
    const contact = await this.repo.findOne({ where: { id, owner } });
    if (!contact) return false;
    await this.repo.remove(contact);
    return true;
  }

  /**
   * Normaliza o número: remove tudo que não for dígito.
   * Garante que o número esteja no formato numérico puro (ex: 5511999999999).
   */
  normalizeNumber(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  /**
   * Converte o número armazenado para o JID do WhatsApp.
   * Ex: "5511999999999" → "5511999999999@s.whatsapp.net"
   */
  toWhatsAppJid(phoneNumber: string): string {
    const normalized = this.normalizeNumber(phoneNumber);
    return `${normalized}@s.whatsapp.net`;
  }

  private toResult(c: PhoneContact): PhoneContactResult {
    return {
      id: c.id,
      name: c.name,
      phoneNumber: c.phoneNumber,
      createdAt: c.createdAt,
    };
  }
}
