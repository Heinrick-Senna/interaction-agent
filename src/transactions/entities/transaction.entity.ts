import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type TransactionType = 'expense' | 'saving';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  type: TransactionType;

  @Column({ type: 'real' })
  amount: number;

  @Column({ type: 'varchar', nullable: true })
  category: string;

  @Column({ type: 'varchar', nullable: true })
  description: string;

  @Column({ type: 'varchar', default: 'BRL' })
  currency: string;

  @Column({ type: 'varchar', nullable: true })
  method: string;

  @Column({ type: 'varchar', nullable: true })
  owner: string;

  // The date the user says the transaction happened (may differ from createdAt)
  @Column({ type: 'varchar' })
  transactionDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
