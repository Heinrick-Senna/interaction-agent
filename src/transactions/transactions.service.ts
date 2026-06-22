import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { Contact } from './entities/contact.entity';
import { ContactJid } from './entities/contact-jid.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';

export interface QueryFilters {
  type?: 'expense' | 'saving' | 'all';
  startDate?: string;
  endDate?: string;
  category?: string;
}

export interface TransactionSummary {
  totalExpenses: number;
  totalSavings: number;
  expensesByCategory: Record<string, number>;
  transactionCount: number;
  period: { start: string; end: string };
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly repo: Repository<Transaction>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(ContactJid)
    private readonly jidRepo: Repository<ContactJid>,
  ) {}

  // Returns the shared contactId for a given JID, creating one if it doesn't exist.
  async resolveContactId(jid: string): Promise<string> {
    const existing = await this.jidRepo.findOne({ where: { jid } });
    if (existing) return existing.contactId;

    const contact = await this.contactRepo.save(this.contactRepo.create({}));
    await this.jidRepo.save(this.jidRepo.create({ jid, contactId: contact.id }));
    return contact.id;
  }

  async create(dto: CreateTransactionDto): Promise<Transaction> {
    const transaction = this.repo.create(dto);
    return this.repo.save(transaction);
  }

  async query(filters: QueryFilters): Promise<Transaction[]> {
    const where: any = {};

    if (filters.type && filters.type !== 'all') {
      where.type = filters.type;
    }

    if (filters.startDate && filters.endDate) {
      where.transactionDate = Between(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      where.transactionDate = Between(filters.startDate, '9999-12-31');
    } else if (filters.endDate) {
      where.transactionDate = Between('0000-01-01', filters.endDate);
    }

    if (filters.category) {
      where.category = Like(`%${filters.category}%`);
    }

    return this.repo.find({ where, order: { transactionDate: 'DESC' } });
  }

  async getSummary(filters: QueryFilters): Promise<TransactionSummary> {
    const transactions = await this.query({ ...filters, type: 'all' });

    const expenses = transactions.filter((t) => t.type === 'expense');
    const savings = transactions.filter((t) => t.type === 'saving');

    const expensesByCategory: Record<string, number> = {};
    for (const t of expenses) {
      const key = t.category ?? 'uncategorized';
      expensesByCategory[key] = (expensesByCategory[key] ?? 0) + t.amount;
    }

    return {
      totalExpenses: expenses.reduce((s, t) => s + t.amount, 0),
      totalSavings: savings.reduce((s, t) => s + t.amount, 0),
      expensesByCategory,
      transactionCount: transactions.length,
      period: {
        start: filters.startDate ?? 'all time',
        end: filters.endDate ?? 'all time',
      },
    };
  }
}
