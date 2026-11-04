// Finance master data (Phase 3): legal entities, GL accounts, categories, reason codes and the vendor
// master are tenant reference data every member reads and only finance admins maintain. Every change is
// audited; duplicates are refused with a stable code.
import { expect, test } from '@playwright/test';
import {
  AuditEventList,
  CategoryList,
  GlAccountList,
  LegalEntity,
  LegalEntityList,
  ReasonCode,
  ReasonCodeList,
  Vendor,
  VendorList,
} from '@bf/contracts';
import { ORG_SEED, SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const tag = () => randomUUID().slice(0, 6).toUpperCase();

test.describe('legal entities', () => {
  test('the four Hyland entities carry functional currency, calendar, tax and ERP codes', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/finance/legal-entities', { headers: await as('employee') }),
      200,
      LegalEntityList,
    );
    const byCode = new Map(list.items.map((l) => [l.code, l]));
    expect(byCode.get('HYL-US')).toMatchObject({
      functionalCurrency: 'USD',
      country: 'US',
      erpCompanyCode: '1000',
      allowedActions: [],
    });
    expect(byCode.get('HYL-IN')).toMatchObject({
      functionalCurrency: 'INR',
      fiscalCalendarName: 'Hyland India (Apr-Mar)',
    });
    expect(byCode.get('HYL-DE')).toMatchObject({ functionalCurrency: 'EUR' });
    expect(byCode.get('HYL-UK')).toMatchObject({
      functionalCurrency: 'GBP',
      id: ORG_SEED.entities.uk,
    });
    expect(byCode.get('HYL-IN')!.costCenterCount).toBeGreaterThanOrEqual(3);
  });

  test('finance admins add and rename entities; duplicates and other roles are refused', async ({
    request,
  }) => {
    const t = tag();
    const group = (
      await expectContract(
        await request.get('/api/finance/legal-entities', { headers: await as('finance-admin') }),
        200,
        LegalEntityList,
      )
    ).items.find((l) => l.code === 'HYL-US')!;
    expect(group.allowedActions).toEqual(['master_data.manage']);
    const body = {
      code: `T-${t}`,
      name: `Scenario entity ${t} B.V.`,
      country: 'NL',
      functionalCurrency: 'EUR',
      fiscalCalendarId: group.fiscalCalendarId,
      erpCompanyCode: `S${t}`,
    };
    const created = await expectContract(
      await request.post('/api/finance/legal-entities', {
        headers: await mutate('finance-admin'),
        data: body,
      }),
      201,
      LegalEntity,
    );
    expect(created).toMatchObject({
      code: `T-${t}`,
      functionalCurrency: 'EUR',
      costCenterCount: 0,
    });
    await expectProblem(
      await request.post('/api/finance/legal-entities', {
        headers: await mutate('finance-admin'),
        data: body,
      }),
      409,
      'DUPLICATE_CODE',
    );
    const renamed = await expectContract(
      await request.patch(`/api/finance/legal-entities/${created.id}`, {
        headers: await mutate('finance-admin'),
        data: { name: `Renamed entity ${t} B.V.`, reason: 'Registered name changed' },
      }),
      200,
      LegalEntity,
    );
    expect(renamed.name).toBe(`Renamed entity ${t} B.V.`);
    await expectProblem(
      await request.patch(`/api/finance/legal-entities/${created.id}`, {
        headers: await mutate('finance-admin'),
        data: { functionalCurrency: 'USD', reason: 'Not allowed' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/finance/legal-entities', {
        headers: await mutate('org-admin'),
        data: { ...body, code: `T-${t}-X` },
      }),
      403,
      'FORBIDDEN',
    );
    const audit = await expectContract(
      await request.get(`/api/audit/events?resourceType=legal_entity&resourceId=${created.id}`, {
        headers: await as('auditor'),
      }),
      200,
      AuditEventList,
    );
    expect(audit.items.map((e) => e.action).sort()).toEqual([
      'legal_entity.changed',
      'legal_entity.created',
    ]);
  });
});

test.describe('GL accounts and categories', () => {
  test('every entity has the seeded chart of expense accounts; categories are the 11 seeded ones', async ({
    request,
  }) => {
    const uk = await expectContract(
      await request.get(`/api/finance/gl-accounts?legalEntityId=${ORG_SEED.entities.uk}`, {
        headers: await as('analyst'),
      }),
      200,
      GlAccountList,
    );
    expect(uk.items.map((a) => a.code)).toEqual(
      expect.arrayContaining(['6100', '6200', '2100', '1400']),
    );
    const cats = await expectContract(
      await request.get('/api/finance/categories', { headers: await as('employee') }),
      200,
      CategoryList,
    );
    expect(cats.items.map((c) => c.code)).toEqual(
      expect.arrayContaining(['employee_events', 'team_lunch', 'wellbeing', 'recognition']),
    );
    expect(cats.items).toHaveLength(11);
    await expectProblem(
      await request.post('/api/finance/gl-accounts', {
        headers: await mutate('finance-admin'),
        data: {
          legalEntityId: SEED.legalEntities.acmeUs,
          code: '6100',
          name: 'Duplicate',
          accountType: 'expense',
        },
      }),
      409,
      'DUPLICATE_CODE',
    );
  });
});

test.describe('reason codes', () => {
  test('the taxonomy covers controls and corrections; codes can be added, retired and reinstated', async ({
    request,
  }) => {
    const all = await expectContract(
      await request.get('/api/finance/reason-codes', { headers: await as('employee') }),
      200,
      ReasonCodeList,
    );
    const categories = new Set(all.items.map((r) => r.category));
    for (const c of [
      'reduction',
      'freeze',
      'transfer',
      'increase',
      'reversal',
      'exception',
      'rejection',
      'manual',
    ])
      expect(categories, c).toContain(c);
    const t = tag();
    const created = await expectContract(
      await request.post('/api/finance/reason-codes', {
        headers: await mutate('finance-admin'),
        data: { category: 'freeze', code: `FRZ-T${t}`, label: `Scenario freeze ${t}` },
      }),
      201,
      ReasonCode,
    );
    await expectProblem(
      await request.post('/api/finance/reason-codes', {
        headers: await mutate('finance-admin'),
        data: { category: 'freeze', code: `FRZ-T${t}`, label: 'Again' },
      }),
      409,
      'DUPLICATE_CODE',
    );
    const retired = await expectContract(
      await request.patch(`/api/finance/reason-codes/${created.id}`, {
        headers: await mutate('finance-admin'),
        data: { active: false },
      }),
      200,
      ReasonCode,
    );
    expect(retired.active).toBe(false);
    const active = await expectContract(
      await request.get('/api/finance/reason-codes?category=freeze', {
        headers: await as('finance-admin'),
      }),
      200,
      ReasonCodeList,
    );
    expect(active.items.map((r) => r.id)).not.toContain(created.id);
    const withRetired = await expectContract(
      await request.get('/api/finance/reason-codes?category=freeze&includeInactive=true', {
        headers: await as('finance-admin'),
      }),
      200,
      ReasonCodeList,
    );
    expect(withRetired.items.map((r) => r.id)).toContain(created.id);
    await expectProblem(
      await request.patch(`/api/finance/reason-codes/${created.id}`, {
        headers: await mutate('department-head'),
        data: { active: true },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('vendor master', () => {
  test('approved, preferred and blocked vendors; finance adds and blocks vendors', async ({
    request,
  }) => {
    const blocked = await expectContract(
      await request.get('/api/finance/vendors?status=blocked', {
        headers: await as('event-organizer'),
      }),
      200,
      VendorList,
    );
    expect(blocked.items.map((v) => v.name)).toEqual(
      expect.arrayContaining(['Metro Party Rentals', 'QuickGift Vouchers']),
    );
    const preferred = await expectContract(
      await request.get('/api/finance/vendors?status=preferred', {
        headers: await as('event-organizer'),
      }),
      200,
      VendorList,
    );
    expect(preferred.items.map((v) => v.country)).toEqual(
      expect.arrayContaining(['US', 'IN', 'GB']),
    );
    const t = tag();
    const vendor = await expectContract(
      await request.post('/api/finance/vendors', {
        headers: await mutate('finance-admin'),
        data: { name: `Scenario Venue ${t}`, status: 'approved', category: 'venue', country: 'IN' },
      }),
      201,
      Vendor,
    );
    await expectProblem(
      await request.post('/api/finance/vendors', {
        headers: await mutate('finance-admin'),
        data: { name: `scenario venue ${t}`, status: 'approved' },
      }),
      409,
      'DUPLICATE_CODE',
    );
    const block = await expectContract(
      await request.patch(`/api/finance/vendors/${vendor.id}`, {
        headers: await mutate('finance-admin'),
        data: { status: 'blocked', reason: 'Failed safety review' },
      }),
      200,
      Vendor,
    );
    expect(block.status).toBe('blocked');
    const search = await expectContract(
      await request.get(`/api/finance/vendors?q=${t}`, { headers: await as('finance-admin') }),
      200,
      VendorList,
    );
    expect(search.items).toEqual([expect.objectContaining({ id: vendor.id, status: 'blocked' })]);
    await expectProblem(
      await request.post('/api/finance/vendors', {
        headers: await mutate('event-organizer'),
        data: { name: `Organizer vendor ${t}`, status: 'approved' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
