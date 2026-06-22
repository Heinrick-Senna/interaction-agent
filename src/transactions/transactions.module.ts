import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { Contact } from './entities/contact.entity';
import { ContactJid } from './entities/contact-jid.entity';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Contact, ContactJid])],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
