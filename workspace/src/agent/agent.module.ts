import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { AiModule } from '../ai/ai.module';
import { DeveloperModule } from '../developer/developer.module';
import { RemindersModule } from '../reminders/reminders.module';
import { PhoneContactsModule } from '../phone-contacts/phone-contacts.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TransactionsModule,
    AiModule,
    DeveloperModule,
    RemindersModule,
    PhoneContactsModule,
    WhatsappModule,
  ],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
