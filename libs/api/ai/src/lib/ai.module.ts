import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
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
import { FakeAiProvider } from './provider/fake-provider';
import { AiQueryLogService } from './query-log.service';
import { AiRetrieval } from './retrieval.service';
import { AiSettingsService } from './settings.service';
import { AiSuggestionsService } from './suggestions.service';

/**
 * The provider behind `AiProvider`. `AI_PROVIDER=fake` (the only value today) binds the deterministic
 * fake, which is what the local stack, functional runs and CI use. A real provider is added here and
 * takes its key from the server environment; nothing in the database or in code holds a credential.
 */
const provider = {
  provide: AiProvider,
  useClass: FakeAiProvider,
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
  imports: [AuditModule, BudgetsModule],
  providers: [provider, ...SERVICES],
  exports: [AiProvider, ...SERVICES],
})
export class AiModule {}

/** AI HTTP endpoints. */
@Module({ imports: [AiModule], controllers: [AiController] })
export class AiApiModule {}
