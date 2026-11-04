import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service';
import { HeadcountService } from './headcount.service';
import { OrgImportService } from './org-import.service';
import { OrgReads } from './org-reads';
import { OrgUnitsService } from './org-units.service';
import { OrgController } from './org.controller';
import { PeopleService } from './people.service';

const SERVICES = [
  OrgReads,
  OrgUnitsService,
  PeopleService,
  CostCentersService,
  HeadcountService,
  OrgImportService,
];

@Module({ imports: [AuditModule], providers: SERVICES, exports: SERVICES })
export class OrgModule {}

@Module({ imports: [OrgModule], controllers: [OrgController] })
export class OrgApiModule {}
