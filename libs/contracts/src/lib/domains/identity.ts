import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, RoleId } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Identity -------------------------------------------------------------------------------------
export const FiscalYearRef = named(
  'FiscalYearRef',
  z
    .object({
      id: Id,
      label: z.string().describe('Display label, e.g. FY2026.'),
      startDate: IsoDate,
      endDate: IsoDate,
    })
    .strict()
    .describe("A fiscal year of the tenant's group calendar."),
);

export const MeResponse = named(
  'MeResponse',
  z
    .object({
      subject: z.string(),
      tenantId: Id,
      tenantName: z.string(),
      reportingCurrency: CurrencyCode,
      personId: Id.nullable(),
      displayName: z.string(),
      roles: z.array(RoleId),
      memberships: z.array(
        z.object({ tenantId: Id, tenantName: z.string(), roles: z.array(RoleId) }).strict(),
      ),
      email: z.string().nullable(),
      jobTitle: z.string().nullable(),
      locationName: z.string().nullable().describe("Name of the person's location org unit."),
      timezone: z
        .string()
        .describe(
          "IANA timezone for showing timestamps: the person's own, else their location's, else the tenant default.",
        ),
      tenantTimezone: z.string().describe("The tenant's default IANA timezone."),
      permissions: z
        .array(z.string())
        .describe(
          'Actions the user may take somewhere in this tenant (from PolicyService). The web hides what is missing; the API enforces.',
        ),
      platformOperator: z
        .boolean()
        .describe(
          'Super Admin without an active break-glass grant: no access to tenant financial data.',
        ),
      fiscalYears: z
        .array(FiscalYearRef)
        .describe("Fiscal years of the tenant's group calendar, oldest first."),
    })
    .strict()
    .describe('The signed-in user in the selected tenant, with every tenant they belong to.'),
);

export type MeResponse = z.infer<typeof MeResponse>;
export type FiscalYearRef = z.infer<typeof FiscalYearRef>;

export const AuthConfigResponse = named(
  'AuthConfigResponse',
  z
    .object({
      issuer: z.url().describe('OpenID Connect issuer (the Keycloak realm URL).'),
      clientId: z.string().describe('Public client of the web app (authorization code with PKCE).'),
    })
    .strict()
    .describe('Where the web app signs users in.'),
);
export type AuthConfigResponse = z.infer<typeof AuthConfigResponse>;

export const identityEndpoints = {
  me: {
    operationId: 'me',
    method: 'get',
    path: '/api/me',
    summary: 'Current user, tenant, permissions and memberships',
    tags: ['identity'],
    auth: true,
    response: { status: 200, schema: MeResponse },
    errors: [401, 403],
  },
  authConfig: {
    operationId: 'authConfig',
    method: 'get',
    path: '/api/auth/config',
    summary: 'Sign-in settings for the web app (issuer and public client id)',
    tags: ['identity'],
    auth: false,
    response: { status: 200, schema: AuthConfigResponse },
    errors: [],
  },
} as const satisfies Record<string, Endpoint>;
