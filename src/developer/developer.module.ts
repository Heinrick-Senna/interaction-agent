import { Module } from '@nestjs/common';
import { DeveloperAgentService } from './developer-agent.service';
import { GithubService } from './github.service';
import { PrReviewService } from './pr-review.service';

@Module({
  providers: [GithubService, DeveloperAgentService, PrReviewService],
  exports: [DeveloperAgentService, PrReviewService],
})
export class DeveloperModule {}
