import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { AiModule } from '../ai/ai.module';
import { DeveloperModule } from '../developer/developer.module';

@Module({
  imports: [TransactionsModule, AiModule, DeveloperModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
