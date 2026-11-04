import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { CalendarsService } from './calendars.service';
import { DoaService } from './doa.service';
import { FinanceController } from './finance.controller';
import { GlService } from './gl.service';
import { LegalEntitiesService } from './legal-entities.service';
import { RatesService } from './rates.service';
import { ReferenceDataService } from './reference-data.service';

const SERVICES = [
  LegalEntitiesService,
  CalendarsService,
  RatesService,
  GlService,
  ReferenceDataService,
  DoaService,
];

@Module({ imports: [AuditModule], providers: SERVICES, exports: SERVICES })
export class FinanceModule {}

@Module({ imports: [FinanceModule], controllers: [FinanceController] })
export class FinanceApiModule {}
