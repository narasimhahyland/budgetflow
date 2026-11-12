import { AdminModule } from '@bf/api/admin';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { DocumentsModule } from '@bf/api/documents';
import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiGateway } from './ai-gateway.service';
import { AiEvaluationsService } from './evals/evaluations.service';
import { AiAllocationService } from './features/allocation.service';
import { AiAnomalyService } from './features/anomaly.service';
import { AiAskService } from './features/ask.service';
import { AiExtractionService } from './features/extraction.service';
import { AiMatchingService } from './features/matching.service';
import { AiOutlookService } from './features/outlook.service';
import { AiPolicyAssistantService } from './features/policy-assistant.service';
import { AiProvider } from './provider/ai-provider';
import { BedrockAiProvider } from './provider/bedrock-provider';

import { AiQueryLogService } from './query-log.service';
import { AiRetrieval } from './retrieval.service';
import { AiSettingsService } from './settings.service';
import { AiSuggestionsService } from './suggestions.service';

/** The provider behind `AiProvider` is Amazon Bedrock; credentials come from the server environment. */
const provider = {
  provide: AiProvider,
  useClass: BedrockAiProvider,
};

const SERVICES = [
  AiGateway,
  AiQueryLogService,
  AiRetrieval,
  AiSettingsService,
  AiSuggestionsService,
  AiEvaluationsService,
  AiAskService,
  AiPolicyAssistantService,
  AiAllocationService,
  AiOutlookService,
  AiMatchingService,
  AiAnomalyService,
  AiExtractionService,
];

/** AI services (also used by the seed). */
@Module({
  imports: [AdminModule, AuditModule, BudgetsModule, DocumentsModule],
  providers: [provider, ...SERVICES],
  exports: [AiProvider, ...SERVICES],
})
export class AiModule {}

/** AI HTTP endpoints. */
@Module({ imports: [AiModule], controllers: [AiController] })
export class AiApiModule {}
