import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reminder } from './entities/reminder.entity';
import { RemindersService } from './reminders.service';
import { RemindersScheduler } from './reminders.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Reminder])],
  providers: [RemindersService, RemindersScheduler],
  exports: [RemindersService],
})
export class RemindersModule {}
