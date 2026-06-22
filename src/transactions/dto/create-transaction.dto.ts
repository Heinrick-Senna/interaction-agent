import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['expense', 'saving'])
  type: 'expense' | 'saving';

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  currency: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsString()
  transactionDate: string;
}
