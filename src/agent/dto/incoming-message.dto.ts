import { IsString, IsNotEmpty, IsObject } from 'class-validator';

// Used by the direct test endpoint POST /api/message
export class DirectMessageDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}

// EvolutionAPI webhook payload (any event)
export class EvolutionWebhookDto {
  @IsString()
  event: string;

  @IsString()
  instance: string;

  @IsObject()
  data: Record<string, any>;
}
