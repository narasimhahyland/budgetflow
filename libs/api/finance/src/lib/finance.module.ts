import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { CalendarsService } from './calendars.service';
import { BenefitsService } from './benefits.service';
import { DoaService } from './doa.service';
import { FinanceController } from './finance.controller';
import { GlService } from './gl.service';
import { LegalEntitiesService } from './legal-entities.service';
import { RatesService } from './rates.service';
import { ReferenceDataService } from './reference-data.service';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

const SERVICES = [
  LegalEntitiesService,
  CalendarsService,
  RatesService,
  GlService,
  ReferenceDataService,
  DoaService,
  TaxService,
  BenefitsService,
];

@Module({ imports: [AuditModule], providers: SERVICES, exports: SERVICES })
export class FinanceModule {}

@Module({ imports: [FinanceModule], controllers: [FinanceController, TaxController] })
export class FinanceApiModule {}
