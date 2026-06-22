import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionsModule } from './transactions/transactions.module';
import { AgentModule } from './agent/agent.module';
import { Transaction } from './transactions/entities/transaction.entity';
import { Contact } from './transactions/entities/contact.entity';
import { ContactJid } from './transactions/entities/contact-jid.entity';
import { RemindersModule } from './reminders/reminders.module';
import { Reminder } from './reminders/entities/reminder.entity';
import { PhoneContactsModule } from './phone-contacts/phone-contacts.module';
import { PhoneContact } from './phone-contacts/entities/phone-contact.entity';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'sqljs',
        autoSave: true,
        location: process.env.DB_PATH ?? './data/finance.sqlite',
        entities: [Transaction, Contact, ContactJid, Reminder, PhoneContact],
        synchronize: true,
        logging: false,
      }),
    }),
    TransactionsModule,
    RemindersModule,
    PhoneContactsModule,
    WhatsappModule,
    AgentModule,
  ],
})
export class AppModule {}
