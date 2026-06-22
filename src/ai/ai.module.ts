import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import { AI_PROVIDER } from './ai-provider.interface';

@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get('AI_PROVIDER', 'openai');
        return provider === 'anthropic' ? new AnthropicProvider(config) : new OpenAiProvider(config);
      },
      inject: [ConfigService],
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
