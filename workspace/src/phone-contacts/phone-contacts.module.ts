import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhoneContact } from './entities/phone-contact.entity';
import { PhoneContactsService } from './phone-contacts.service';

@Module({
  imports: [TypeOrmModule.forFeature([PhoneContact])],
  providers: [PhoneContactsService],
  exports: [PhoneContactsService],
})
export class PhoneContactsModule {}
