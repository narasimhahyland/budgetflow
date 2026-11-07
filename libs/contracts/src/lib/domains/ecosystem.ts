import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Phase 16, the ecosystem (screens 092a, 092b, 092c, 092d, 102d).
 *
 * These are the surfaces BudgetFlow exposes to things that are not BudgetFlow: a BI tool, an AI
 * assistant, a no-code automation platform, a booking partner and a widget on an intranet page. They
 * all follow the same three rules.
 *
 * 1. **A person, not a service.** Every connection acts as the person who created it, under their
 *    own `PolicyService` scope and the tenant row level security of their tenant. The token names
 *    its tenant, so the database session is scoped before anything is read. No surface here holds a
 *    company-wide key.
 * 2. **Read first.** The only write any of these surfaces can reach is a Draft request that a person
 *    must open and submit in BudgetFlow, and it goes through the ordinary authorized command with
 *    its own idempotency key and audit entry. Nothing here approves, submits, applies a control or
 *    moves money.
 * 3. **Identity is never taken from the caller's page.** A widget gets its viewer from the bearer
 *    token, never from a query parameter, a `postMessage` or the embedding site; the embedding site
 *    only decides whether the frame is allowed to render at all.
 */

// Shared ------------------------------------------------------------------------------------------

export const ECOSYSTEM_SURFACES = ['bi', 'assistants', 'automations', 'marketplace'] as const;
export const EcosystemSurface = z
  .enum(ECOSYSTEM_SURFACES)
  .describe('An external surface with its own switch and configuration (092a-092d).');
export type EcosystemSurface = z.infer<typeof EcosystemSurface>;

export const ECOSYSTEM_CONNECTION_KINDS = ['bi', 'assistant', 'automation'] as const;
export const EcosystemConnectionKind = z
  .enum(ECOSYSTEM_CONNECTION_KINDS)
  .describe('What a personal connection is for; each kind has its own grants and lifetime.');
export type EcosystemConnectionKind = z.infer<typeof EcosystemConnectionKind>;

export const ECOSYSTEM_CONNECTION_STATUSES = [
  'active',
  'expiring_soon',
  'expired',
  'revoked',
] as const;
export const EcosystemConnectionStatus = z.enum(ECOSYSTEM_CONNECTION_STATUSES);
export type EcosystemConnectionStatus = z.infer<typeof EcosystemConnectionStatus>;

export const EcosystemConnectionView = named(
  'EcosystemConnectionView',
  z
    .object({
      id: Id,
      kind: EcosystemConnectionKind,
      /** The tool, assistant app or platform on the other end (`power_bi`, `zapier`, a client id). */
      clientKey: z.string(),
      clientLabel: z.string(),
      label: z.string().describe('What the person called this connection.'),
      personId: Id.nullable(),
      personName: z.string().nullable(),
      grants: z
        .array(z.string())
        .describe(
          'Datasets, tools or actions this connection may use, never more than its person may.',
        ),
      status: EcosystemConnectionStatus,
      createdAt: IsoDateTime,
      lastUsedAt: IsoDateTime.nullable(),
      expiresAt: IsoDateTime,
      revokedAt: IsoDateTime.nullable(),
      callsLast7Days: z.int(),
    })
    .strict()
    .describe("A personal connection from an outside tool, acting with its creator's scope."),
);
export type EcosystemConnectionView = z.infer<typeof EcosystemConnectionView>;

export const EcosystemConnectionList = named(
  'EcosystemConnectionList',
  z
    .object({
      items: z.array(EcosystemConnectionView),
      /** True when the reader may see and revoke everyone's connections, not only their own. */
      seesAll: z.boolean(),
      canRevokeAll: z.boolean(),
    })
    .strict(),
);
export type EcosystemConnectionList = z.infer<typeof EcosystemConnectionList>;

export const EcosystemConnectionCreated = named(
  'EcosystemConnectionCreated',
  z
    .object({
      connection: EcosystemConnectionView,
      token: z.string().describe('Shown once and stored hashed; paste it into the outside tool.'),
      notice: z.string(),
    })
    .strict(),
);
export type EcosystemConnectionCreated = z.infer<typeof EcosystemConnectionCreated>;

export const RevokeConnectionRequest = named(
  'RevokeConnectionRequest',
  z.object({ reason: z.string().trim().max(500).optional() }).strict(),
);
export type RevokeConnectionRequest = z.infer<typeof RevokeConnectionRequest>;

const ConnectionParams = z.object({ connectionId: Id }).strict();

/** Every surface answers the same question: may this reader configure it, and may they connect? */
const SurfaceCapabilities = {
  canManage: z
    .boolean()
    .describe("`integration.manage`: enable the surface and revoke anyone's connection."),
  canConnect: z.boolean().describe('Whether this reader may create a connection of their own.'),
};

// BI connector (092a) -----------------------------------------------------------------------------

export const BI_DATASETS = [
  'budgets',
  'company_rollup',
  'ledger_summary',
  'events',
  'requests',
] as const;
export const BiDataset = z
  .enum(BI_DATASETS)
  .describe('A curated read-only dataset with the same definitions as the app.');
export type BiDataset = z.infer<typeof BiDataset>;

export const BI_TOOLS = ['power_bi', 'tableau'] as const;
export const BiTool = z.enum(BI_TOOLS);
export type BiTool = z.infer<typeof BiTool>;

export const BiFieldRef = named(
  'BiFieldRef',
  z.object({ name: z.string(), description: z.string() }).strict(),
);

export const BiDatasetView = named(
  'BiDatasetView',
  z
    .object({
      dataset: BiDataset,
      title: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      fields: z.array(BiFieldRef),
    })
    .strict(),
);
export type BiDatasetView = z.infer<typeof BiDatasetView>;

export const BiConnectorView = named(
  'BiConnectorView',
  z
    .object({
      enabled: z.boolean(),
      feedBaseUrl: z
        .string()
        .describe('Where a BI tool points its feed; the person signs in with their own token.'),
      datasets: z.array(BiDatasetView),
      connectionsActive: z.int(),
      refreshesLast24h: z.int(),
      refreshLimitPerDay: z.int().describe('Refreshes one connection may make in a day (092a).'),
      maxRowsPerRequest: z.int(),
      connectionLifetimeDays: z.int(),
      notice: z.string(),
      ...SurfaceCapabilities,
    })
    .strict(),
);
export type BiConnectorView = z.infer<typeof BiConnectorView>;

export const UpdateBiConnectorRequest = named(
  'UpdateBiConnectorRequest',
  z
    .object({
      enabled: z.boolean().optional(),
      datasets: z
        .array(z.object({ dataset: BiDataset, enabled: z.boolean() }).strict())
        .max(BI_DATASETS.length)
        .optional(),
    })
    .strict(),
);
export type UpdateBiConnectorRequest = z.infer<typeof UpdateBiConnectorRequest>;

export const CreateBiConnectionRequest = named(
  'CreateBiConnectionRequest',
  z
    .object({
      tool: BiTool,
      label: z.string().trim().min(1).max(120),
      datasets: z
        .array(BiDataset)
        .min(1)
        .max(BI_DATASETS.length)
        .describe('Datasets this connection may read; each must be enabled for the company.'),
    })
    .strict(),
);
export type CreateBiConnectionRequest = z.infer<typeof CreateBiConnectionRequest>;

export const BiFeedPage = named(
  'BiFeedPage',
  z
    .object({
      dataset: BiDataset,
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .describe('Rows the connecting person may read, in a stable order (name, then id).'),
      rowCount: z.int(),
      nextCursor: z.string().nullable(),
      generatedAt: IsoDateTime,
      refreshesRemainingToday: z.int(),
      currency: CurrencyCode.describe('Reporting currency of the figures in this page.'),
    })
    .strict(),
);
export type BiFeedPage = z.infer<typeof BiFeedPage>;

const BiFeedParams = z.object({ dataset: BiDataset }).strict();
const BiFeedQuery = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict();

// Connector for AI assistants (092c) ---------------------------------------------------------------

export const ASSISTANT_TOOLS = [
  'list_my_budgets',
  'get_budget_balance',
  'list_my_requests',
  'get_request_status',
  'list_waiting_approvals',
  'search_events',
] as const;
export const AssistantTool = z
  .enum(ASSISTANT_TOOLS)
  .describe('A read-only tool an assistant may call. There is no tool that writes.');
export type AssistantTool = z.infer<typeof AssistantTool>;

export const AssistantToolView = named(
  'AssistantToolView',
  z
    .object({
      tool: AssistantTool,
      title: z.string(),
      description: z.string().describe('Shown to assistants and in the consent dialog.'),
      enabled: z.boolean(),
    })
    .strict(),
);
export type AssistantToolView = z.infer<typeof AssistantToolView>;

export const AssistantConnectorView = named(
  'AssistantConnectorView',
  z
    .object({
      enabled: z.boolean(),
      serverUrl: z.string(),
      protocolVersion: z.string(),
      tools: z.array(AssistantToolView),
      allowedApps: z
        .array(z.string())
        .nullable()
        .describe('Named assistant apps that may connect; null means any app that can sign in.'),
      connectedPeople: z.int(),
      toolCallsLast7Days: z.int(),
      maxRecordsPerCall: z
        .int()
        .describe('Hard cap per call, so the connector is not a bulk export.'),
      connectionLifetimeDays: z.int(),
      aiFeatureFlagKey: z.string().describe('`ai.mcp`: the 113a switch that must also be on.'),
      aiFeatureEnabled: z.boolean(),
      consentText: z.string(),
      neverDoes: z.array(z.string()),
      ...SurfaceCapabilities,
    })
    .strict(),
);
export type AssistantConnectorView = z.infer<typeof AssistantConnectorView>;

export const UpdateAssistantConnectorRequest = named(
  'UpdateAssistantConnectorRequest',
  z
    .object({
      enabled: z.boolean().optional(),
      tools: z
        .array(z.object({ tool: AssistantTool, enabled: z.boolean() }).strict())
        .max(ASSISTANT_TOOLS.length)
        .optional(),
      allowedApps: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
    })
    .strict(),
);
export type UpdateAssistantConnectorRequest = z.infer<typeof UpdateAssistantConnectorRequest>;

export const CreateAssistantConnectionRequest = named(
  'CreateAssistantConnectionRequest',
  z
    .object({
      appKey: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('Client registration of the assistant app.'),
      label: z.string().trim().min(1).max(120),
      tools: z.array(AssistantTool).min(1).max(ASSISTANT_TOOLS.length),
      consentAcknowledged: z
        .literal(true)
        .describe('The person saw the consent text and chose Allow (092c).'),
    })
    .strict(),
);
export type CreateAssistantConnectionRequest = z.infer<typeof CreateAssistantConnectionRequest>;

export const McpToolDescriptor = named(
  'McpToolDescriptor',
  z
    .object({
      name: AssistantTool,
      title: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()).describe('JSON Schema of the tool arguments.'),
      readOnly: z.literal(true),
    })
    .strict(),
);

export const McpToolListResult = named(
  'McpToolListResult',
  z
    .object({
      protocolVersion: z.string(),
      serverName: z.string(),
      tools: z.array(McpToolDescriptor),
      notice: z.string(),
    })
    .strict(),
);
export type McpToolListResult = z.infer<typeof McpToolListResult>;

export const McpToolCallRequest = named(
  'McpToolCallRequest',
  z
    .object({
      tool: AssistantTool,
      arguments: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
);
export type McpToolCallRequest = z.infer<typeof McpToolCallRequest>;

export const McpToolCallResult = named(
  'McpToolCallResult',
  z
    .object({
      tool: AssistantTool,
      records: z.array(z.record(z.string(), z.unknown())),
      recordCount: z.int(),
      truncated: z.boolean().describe('True when the cap hid further records the person may see.'),
      /** The neutral out-of-scope wording of 011a, so a miss never confirms a record exists. */
      notice: z.string(),
      links: z.array(z.object({ label: z.string(), url: z.string() }).strict()),
    })
    .strict(),
);
export type McpToolCallResult = z.infer<typeof McpToolCallResult>;

// No-code connectors (092b) ------------------------------------------------------------------------

export const NO_CODE_PLATFORMS = ['zapier', 'make', 'power_automate', 'workato'] as const;
export const NoCodePlatform = z.enum(NO_CODE_PLATFORMS);
export type NoCodePlatform = z.infer<typeof NoCodePlatform>;

export const AUTOMATION_ACTIONS = ['budget.balance.read', 'request.draft.create'] as const;
export const AutomationAction = z
  .enum(AUTOMATION_ACTIONS)
  .describe('What an automation may do, as the person who connected it.');
export type AutomationAction = z.infer<typeof AutomationAction>;

export const AUTOMATION_TRIGGERS = [
  'budget.threshold_reached',
  'budget.frozen',
  'budget.reduced',
  'budget.set_to_zero',
  'request.submitted',
  'request.decided',
  'contribution.decided',
  'event.approved',
  'event.closed',
  'actual.matched',
  'period.closed',
] as const;
export const AutomationTrigger = z.enum(AUTOMATION_TRIGGERS);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

export const NoCodePlatformView = named(
  'NoCodePlatformView',
  z
    .object({
      platform: NoCodePlatform,
      title: z.string(),
      allowed: z.boolean(),
      automationsActive: z.int(),
      lastChangedAt: IsoDateTime.nullable(),
      lastChangedByName: z.string().nullable(),
    })
    .strict(),
);
export type NoCodePlatformView = z.infer<typeof NoCodePlatformView>;

export const AutomationConnectorView = named(
  'AutomationConnectorView',
  z
    .object({
      enabled: z.boolean(),
      platforms: z.array(NoCodePlatformView),
      actions: z.array(
        z.object({ action: AutomationAction, title: z.string(), description: z.string() }).strict(),
      ),
      triggers: z.array(
        z
          .object({
            trigger: AutomationTrigger,
            title: z.string(),
            /** False while per-person payload scoping is not built; the catalogue is still listed. */
            deliveryAvailable: z.boolean(),
          })
          .strict(),
      ),
      automationsActive: z.int(),
      runsLast7Days: z.int(),
      connectionLifetimeDays: z.int(),
      consentText: z.string(),
      neverDoes: z.array(z.string()),
      ...SurfaceCapabilities,
    })
    .strict(),
);
export type AutomationConnectorView = z.infer<typeof AutomationConnectorView>;

export const UpdateNoCodePlatformRequest = named(
  'UpdateNoCodePlatformRequest',
  z.object({ allowed: z.boolean() }).strict(),
);
export type UpdateNoCodePlatformRequest = z.infer<typeof UpdateNoCodePlatformRequest>;

export const CreateAutomationRequest = named(
  'CreateAutomationRequest',
  z
    .object({
      platform: NoCodePlatform,
      label: z.string().trim().min(1).max(120),
      actions: z.array(AutomationAction).min(1).max(AUTOMATION_ACTIONS.length),
      consentAcknowledged: z.literal(true),
    })
    .strict(),
);
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequest>;

export const AutomationBalanceResult = named(
  'AutomationBalanceResult',
  z
    .object({
      budgetId: Id,
      name: z.string(),
      status: z.string(),
      currency: CurrencyCode,
      authorized: Money,
      committed: Money.describe(
        'Pre-encumbered plus encumbered: money promised but not yet spent.',
      ),
      actual: Money,
      availableUnderRules: Money.describe(
        '"Available under this budget\'s rules" (the app\'s definition).',
      ),
    })
    .strict(),
);
export type AutomationBalanceResult = z.infer<typeof AutomationBalanceResult>;

export const AutomationDraftRequestBody = named(
  'AutomationDraftRequestBody',
  z
    .object({
      budgetId: Id,
      amount: Money,
      spendType: z.string().trim().min(1).max(50),
      title: z.string().trim().min(3).max(200),
      purpose: z.string().trim().min(3).max(4000),
      category: z.string().trim().max(50).optional(),
      neededBy: IsoDate.optional(),
    })
    .strict()
    .describe('Creates a Draft only. The person opens and submits it in BudgetFlow.'),
);
export type AutomationDraftRequestBody = z.infer<typeof AutomationDraftRequestBody>;

export const AutomationDraftRequestResult = named(
  'AutomationDraftRequestResult',
  z
    .object({
      requestId: Id,
      ref: z.string(),
      status: z.literal('draft'),
      label: z.string().describe('"Drafted by Zapier for Kavya Shah", shown on the request.'),
      openUrl: z.string(),
      notice: z.string(),
    })
    .strict(),
);
export type AutomationDraftRequestResult = z.infer<typeof AutomationDraftRequestResult>;

// Partner marketplace (092d) -----------------------------------------------------------------------

export const MARKETPLACE_CATEGORIES = ['experiences', 'catering', 'gifts_and_kits'] as const;
export const MarketplaceCategory = z.enum(MARKETPLACE_CATEGORIES);
export type MarketplaceCategory = z.infer<typeof MarketplaceCategory>;

export const PARTNER_STATUSES = ['enabled', 'paused'] as const;
export const PartnerStatus = z.enum(PARTNER_STATUSES);
export type PartnerStatus = z.infer<typeof PartnerStatus>;

export const PartnerView = named(
  'PartnerView',
  z
    .object({
      id: Id,
      name: z.string(),
      slug: z.string(),
      categories: z.array(MarketplaceCategory),
      cities: z.array(z.string()),
      vendorId: Id.nullable(),
      vendorName: z.string().nullable(),
      vendorStatus: z
        .string()
        .nullable()
        .describe('From the vendor master (106c); offers need Approved or Preferred.'),
      mode: z.enum(['mock', 'sandbox', 'live']),
      status: PartnerStatus,
      offersCached: z.int(),
      lastSyncedAt: IsoDateTime.nullable(),
      dataShared: z.array(z.string()),
    })
    .strict(),
);
export type PartnerView = z.infer<typeof PartnerView>;

export const PartnerList = named(
  'PartnerList',
  z.object({ items: z.array(PartnerView), canManage: z.boolean() }).strict(),
);
export type PartnerList = z.infer<typeof PartnerList>;

export const UpdatePartnerRequest = named(
  'UpdatePartnerRequest',
  z
    .object({
      status: PartnerStatus.optional(),
      mode: z.enum(['mock', 'sandbox', 'live']).optional(),
      vendorId: Id.nullable().optional(),
    })
    .strict(),
);
export type UpdatePartnerRequest = z.infer<typeof UpdatePartnerRequest>;

export const PartnerSyncResult = named(
  'PartnerSyncResult',
  z
    .object({
      partnerId: Id,
      offersAdded: z.int(),
      offersUpdated: z.int(),
      offersWithdrawn: z.int(),
      bookingResponses: z.int(),
      syncedAt: IsoDateTime,
    })
    .strict(),
);
export type PartnerSyncResult = z.infer<typeof PartnerSyncResult>;

export const OfferView = named(
  'OfferView',
  z
    .object({
      id: Id,
      partnerId: Id,
      partnerName: z.string(),
      title: z.string(),
      category: MarketplaceCategory,
      city: z.string(),
      pricePerHead: Money.describe("In the partner's local currency."),
      pricePerHeadReporting: Money.describe('At the fiscal year plan rate; never consumes budget.'),
      capacityMin: z.int(),
      capacityMax: z.int(),
      ratingBps: z
        .int()
        .nullable()
        .describe('Average rating from past events, in basis points of 5.'),
      ratingCount: z.int(),
      vendorStatus: z.string().nullable(),
      includes: z.array(z.string()),
      cancellationTerms: z.string(),
      deliveryCountries: z.array(z.string()),
    })
    .strict(),
);
export type OfferView = z.infer<typeof OfferView>;

export const OfferList = named(
  'OfferList',
  z.object({ items: z.array(OfferView), nextCursor: z.string().nullable() }).strict(),
);
export type OfferList = z.infer<typeof OfferList>;

const OffersQuery = z
  .object({
    city: z.string().trim().max(80).optional(),
    category: MarketplaceCategory.optional(),
    people: z.coerce.number().int().min(1).max(100_000).optional(),
    maxPricePerHeadMinor: z.coerce.number().int().min(0).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const BOOKING_STATUSES = ['waiting_for_partner', 'quoted', 'declined', 'cancelled'] as const;
export const BookingStatus = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const BookingView = named(
  'BookingView',
  z
    .object({
      id: Id,
      offerId: Id,
      offerTitle: z.string(),
      partnerName: z.string(),
      eventId: Id,
      eventName: z.string(),
      peopleCount: z.int(),
      requestedDate: IsoDate,
      status: BookingStatus,
      partnerReference: z.string().nullable(),
      quotedPricePerHead: Money.nullable(),
      quotedTotal: Money.nullable(),
      declineReason: z.string().nullable(),
      alternatives: z.array(IsoDate),
      requestedByName: z.string().nullable(),
      createdAt: IsoDateTime,
      respondedAt: IsoDateTime.nullable(),
      notice: z.string(),
    })
    .strict()
    .describe('A booking request is a quote, never a commitment: approval happens the usual way.'),
);
export type BookingView = z.infer<typeof BookingView>;

export const BookingList = named('BookingList', z.object({ items: z.array(BookingView) }).strict());
export type BookingList = z.infer<typeof BookingList>;

export const CreateBookingRequest = named(
  'CreateBookingRequest',
  z
    .object({
      offerId: Id,
      eventId: Id,
      peopleCount: z.int().min(1).max(100_000),
      requestedDate: IsoDate,
      notes: z.string().trim().max(2000).optional(),
    })
    .strict(),
);
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;

// Embeddable widgets (102d) -------------------------------------------------------------------------

export const WIDGET_KINDS = ['team_budget', 'upcoming_events'] as const;
export const WidgetKind = z.enum(WIDGET_KINDS);
export type WidgetKind = z.infer<typeof WidgetKind>;

export const WIDGET_STATUSES = ['active', 'paused'] as const;
export const WidgetStatus = z.enum(WIDGET_STATUSES);
export type WidgetStatus = z.infer<typeof WidgetStatus>;

/**
 * An exact site origin (scheme, host and optional port, no path), the only form `frame-ancestors`
 * can enforce. A wildcard would let any page on any host frame the widget, so it is refused.
 */
export const WidgetOrigin = named(
  'WidgetOrigin',
  z
    .string()
    .trim()
    .max(200)
    .regex(
      /^https?:\/\/[a-z0-9.-]+(:\d{2,5})?$/i,
      'Give the exact site address, for example https://intranet.example.test',
    ),
);

export const WidgetView = named(
  'WidgetView',
  z
    .object({
      id: Id,
      name: z.string(),
      kind: WidgetKind,
      allowedOrigins: z.array(WidgetOrigin),
      showAmounts: z.boolean(),
      eventCount: z.int(),
      status: WidgetStatus,
      viewsLast30Days: z.int(),
      blockedOriginsLast30Days: z
        .array(z.object({ origin: z.string(), attempts: z.int() }).strict())
        .describe('Sites that tried to show the widget and are not on the list (102d).'),
      frameAncestors: z
        .string()
        .describe('The `frame-ancestors` value the embed route is served with.'),
      embedSnippet: z.string(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict(),
);
export type WidgetView = z.infer<typeof WidgetView>;

export const WidgetList = named(
  'WidgetList',
  z.object({ items: z.array(WidgetView), canManage: z.boolean() }).strict(),
);
export type WidgetList = z.infer<typeof WidgetList>;

export const CreateWidgetRequest = named(
  'CreateWidgetRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120),
      kind: WidgetKind,
      allowedOrigins: z.array(WidgetOrigin).min(1).max(25),
      showAmounts: z.boolean().default(true),
      eventCount: z.int().min(1).max(10).default(3),
    })
    .strict(),
);
export type CreateWidgetRequest = z.infer<typeof CreateWidgetRequest>;

export const UpdateWidgetRequest = named(
  'UpdateWidgetRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      allowedOrigins: z.array(WidgetOrigin).min(1).max(25).optional(),
      showAmounts: z.boolean().optional(),
      eventCount: z.int().min(1).max(10).optional(),
      status: WidgetStatus.optional(),
    })
    .strict(),
);
export type UpdateWidgetRequest = z.infer<typeof UpdateWidgetRequest>;

export const WidgetTeamBudget = named(
  'WidgetTeamBudget',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      headline: z.string().describe('Plain sentence; carries no figure when amounts are hidden.'),
      available: Money.nullable(),
      authorized: Money.nullable(),
      utilizationBps: z.int().nullable(),
      status: z.string(),
      canRequest: z.boolean(),
    })
    .strict(),
);
export type WidgetTeamBudget = z.infer<typeof WidgetTeamBudget>;

export const WidgetEvent = named(
  'WidgetEvent',
  z
    .object({
      eventId: Id,
      name: z.string(),
      startDate: IsoDate.nullable(),
      city: z.string().nullable(),
      rsvpStatus: z.string().nullable(),
      canRsvp: z.boolean(),
    })
    .strict(),
);
export type WidgetEvent = z.infer<typeof WidgetEvent>;

export const WidgetContent = named(
  'WidgetContent',
  z
    .object({
      widgetId: Id,
      kind: WidgetKind,
      showAmounts: z.boolean(),
      viewerName: z
        .string()
        .nullable()
        .describe('The signed-in viewer, from their token and nothing else.'),
      teamBudget: WidgetTeamBudget.nullable(),
      events: z.array(WidgetEvent),
      emptyMessage: z.string().nullable(),
      openInAppUrl: z.string(),
      frameAncestors: z.string(),
    })
    .strict()
    .describe('What one viewer sees in one widget. Never more than they could see in BudgetFlow.'),
);
export type WidgetContent = z.infer<typeof WidgetContent>;

const WidgetParams = z.object({ widgetId: Id }).strict();
const PartnerParams = z.object({ partnerId: Id }).strict();
const PlatformParams = z.object({ platform: NoCodePlatform }).strict();
const OfferParams = z.object({ offerId: Id }).strict();

// Endpoints ----------------------------------------------------------------------------------------

export const ecosystemEndpoints = {
  // BI connector (092a)
  getBiConnector: {
    operationId: 'getBiConnector',
    method: 'get',
    path: '/api/ecosystem/bi',
    summary: 'BI connector status, datasets and usage (092a)',
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: BiConnectorView },
    errors: [401, 403],
  },
  updateBiConnector: {
    operationId: 'updateBiConnector',
    method: 'patch',
    path: '/api/ecosystem/bi',
    summary: 'Enable the connector and choose which datasets it offers',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: UpdateBiConnectorRequest,
    response: { status: 200, schema: BiConnectorView },
    errors: [400, 401, 403, 422],
  },
  listBiConnections: {
    operationId: 'listBiConnections',
    method: 'get',
    path: '/api/ecosystem/bi/connections',
    summary: "My BI connections, or everyone's for an Integration Admin",
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: EcosystemConnectionList },
    errors: [401, 403],
  },
  createBiConnection: {
    operationId: 'createBiConnection',
    method: 'post',
    path: '/api/ecosystem/bi/connections',
    summary: 'Connect Power BI or Tableau with my own scope; the token is shown once',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: CreateBiConnectionRequest,
    response: { status: 201, schema: EcosystemConnectionCreated },
    errors: [400, 401, 403, 409, 422],
  },
  revokeBiConnection: {
    operationId: 'revokeBiConnection',
    method: 'post',
    path: '/api/ecosystem/bi/connections/{connectionId}/revoke',
    summary: 'Revoke a BI connection; the next refresh fails with "Access revoked"',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: RevokeConnectionRequest,
    response: { status: 200, schema: EcosystemConnectionView },
    errors: [400, 401, 403, 404, 409],
  },
  readBiFeed: {
    operationId: 'readBiFeed',
    method: 'get',
    path: '/api/bi/v1/{dataset}',
    summary: "BI feed: read-only rows in the connecting person's scope (connection token)",
    tags: ['bi-feed'],
    auth: false,
    params: BiFeedParams,
    query: BiFeedQuery,
    response: { status: 200, schema: BiFeedPage },
    errors: [400, 401, 403, 404, 409, 429],
  },

  // Connector for AI assistants (092c)
  getAssistantConnector: {
    operationId: 'getAssistantConnector',
    method: 'get',
    path: '/api/ecosystem/assistants',
    summary: 'AI assistant connector: tools, allowed apps and usage (092c)',
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: AssistantConnectorView },
    errors: [401, 403],
  },
  updateAssistantConnector: {
    operationId: 'updateAssistantConnector',
    method: 'patch',
    path: '/api/ecosystem/assistants',
    summary: 'Enable the connector, choose tools and allow assistant apps',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: UpdateAssistantConnectorRequest,
    response: { status: 200, schema: AssistantConnectorView },
    errors: [400, 401, 403, 422],
  },
  listAssistantConnections: {
    operationId: 'listAssistantConnections',
    method: 'get',
    path: '/api/ecosystem/assistants/connections',
    summary: "My connected assistants, or everyone's for an Integration Admin",
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: EcosystemConnectionList },
    errors: [401, 403],
  },
  createAssistantConnection: {
    operationId: 'createAssistantConnection',
    method: 'post',
    path: '/api/ecosystem/assistants/connections',
    summary: 'Allow an assistant to read what I can see for 30 days',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: CreateAssistantConnectionRequest,
    response: { status: 201, schema: EcosystemConnectionCreated },
    errors: [400, 401, 403, 409, 422],
  },
  revokeAssistantConnection: {
    operationId: 'revokeAssistantConnection',
    method: 'post',
    path: '/api/ecosystem/assistants/connections/{connectionId}/revoke',
    summary: 'Revoke an assistant connection; the next tool call fails',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: RevokeConnectionRequest,
    response: { status: 200, schema: EcosystemConnectionView },
    errors: [400, 401, 403, 404, 409],
  },
  listMcpTools: {
    operationId: 'listMcpTools',
    method: 'post',
    path: '/api/mcp/v1/tools/list',
    summary: 'Model Context Protocol: the read-only tools this connection may call',
    tags: ['mcp'],
    auth: false,
    response: { status: 200, schema: McpToolListResult },
    errors: [401, 403, 409, 429],
  },
  callMcpTool: {
    operationId: 'callMcpTool',
    method: 'post',
    path: '/api/mcp/v1/tools/call',
    summary: "Model Context Protocol: call one read-only tool in the person's scope",
    tags: ['mcp'],
    auth: false,
    body: McpToolCallRequest,
    response: { status: 200, schema: McpToolCallResult },
    errors: [400, 401, 403, 404, 409, 422, 429],
  },

  // No-code connectors (092b)
  getAutomationConnector: {
    operationId: 'getAutomationConnector',
    method: 'get',
    path: '/api/ecosystem/automations',
    summary: 'No-code platforms, triggers and the actions an automation may take (092b)',
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: AutomationConnectorView },
    errors: [401, 403],
  },
  updateNoCodePlatform: {
    operationId: 'updateNoCodePlatform',
    method: 'patch',
    path: '/api/ecosystem/automations/platforms/{platform}',
    summary: 'Allow or stop allowing a no-code platform; all start Not allowed',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: PlatformParams,
    body: UpdateNoCodePlatformRequest,
    response: { status: 200, schema: AutomationConnectorView },
    errors: [400, 401, 403, 422],
  },
  listAutomations: {
    operationId: 'listAutomations',
    method: 'get',
    path: '/api/ecosystem/automations/connections',
    summary: "My automations, or everyone's for an Integration Admin",
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: EcosystemConnectionList },
    errors: [401, 403],
  },
  createAutomation: {
    operationId: 'createAutomation',
    method: 'post',
    path: '/api/ecosystem/automations/connections',
    summary: 'Connect a no-code platform as me, for the actions I allow',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: CreateAutomationRequest,
    response: { status: 201, schema: EcosystemConnectionCreated },
    errors: [400, 401, 403, 409, 422],
  },
  revokeAutomation: {
    operationId: 'revokeAutomation',
    method: 'post',
    path: '/api/ecosystem/automations/connections/{connectionId}/revoke',
    summary: "Revoke an automation; the platform's next call fails",
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: RevokeConnectionRequest,
    response: { status: 200, schema: EcosystemConnectionView },
    errors: [400, 401, 403, 404, 409],
  },
  readAutomationBalance: {
    operationId: 'readAutomationBalance',
    method: 'get',
    path: '/api/automation/v1/budgets/{budgetId}/balance',
    summary: "Automation: one budget's balance, if the connected person may read it",
    tags: ['automation'],
    auth: false,
    params: z.object({ budgetId: Id }).strict(),
    response: { status: 200, schema: AutomationBalanceResult },
    errors: [401, 403, 404, 409, 429],
  },
  createAutomationDraftRequest: {
    operationId: 'createAutomationDraftRequest',
    method: 'post',
    path: '/api/automation/v1/requests/drafts',
    summary: 'Automation: create a Draft request the person must submit in BudgetFlow',
    tags: ['automation'],
    auth: false,
    idempotent: true,
    body: AutomationDraftRequestBody,
    response: { status: 201, schema: AutomationDraftRequestResult },
    errors: [400, 401, 403, 404, 409, 422, 429],
  },

  // Partner marketplace (092d)
  listPartners: {
    operationId: 'listPartners',
    method: 'get',
    path: '/api/ecosystem/marketplace/partners',
    summary: 'Marketplace partners with their vendor link and connection mode (092d)',
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: PartnerList },
    errors: [401, 403],
  },
  updatePartner: {
    operationId: 'updatePartner',
    method: 'patch',
    path: '/api/ecosystem/marketplace/partners/{partnerId}',
    summary: 'Enable or pause a partner and link it to an approved vendor',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: PartnerParams,
    body: UpdatePartnerRequest,
    response: { status: 200, schema: PartnerView },
    errors: [400, 401, 403, 404, 422],
  },
  syncPartner: {
    operationId: 'syncPartner',
    method: 'post',
    path: '/api/ecosystem/marketplace/partners/{partnerId}/sync',
    summary: "Pull the partner's catalogue and any answers to open booking requests",
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: PartnerParams,
    response: { status: 200, schema: PartnerSyncResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listOffers: {
    operationId: 'listOffers',
    method: 'get',
    path: '/api/marketplace/offers',
    summary: 'Browse offers from enabled partners, filtered by city, category, people and price',
    tags: ['marketplace'],
    auth: true,
    query: OffersQuery,
    response: { status: 200, schema: OfferList },
    errors: [400, 401, 403],
  },
  getOffer: {
    operationId: 'getOffer',
    method: 'get',
    path: '/api/marketplace/offers/{offerId}',
    summary: 'One offer with what is included and its cancellation terms',
    tags: ['marketplace'],
    auth: true,
    params: OfferParams,
    response: { status: 200, schema: OfferView },
    errors: [401, 403, 404],
  },
  listBookings: {
    operationId: 'listBookings',
    method: 'get',
    path: '/api/marketplace/bookings',
    summary: 'Booking requests on events I can see',
    tags: ['marketplace'],
    auth: true,
    response: { status: 200, schema: BookingList },
    errors: [401, 403],
  },
  createBooking: {
    operationId: 'createBooking',
    method: 'post',
    path: '/api/marketplace/bookings',
    summary: 'Ask a partner for a booking; it becomes a quote, never a commitment',
    tags: ['marketplace'],
    auth: true,
    idempotent: true,
    body: CreateBookingRequest,
    response: { status: 201, schema: BookingView },
    errors: [400, 401, 403, 404, 409, 422],
  },

  // Embeddable widgets (102d)
  listWidgets: {
    operationId: 'listWidgets',
    method: 'get',
    path: '/api/ecosystem/widgets',
    summary: 'Embeddable widgets with their allowed sites and usage (102d)',
    tags: ['ecosystem'],
    auth: true,
    response: { status: 200, schema: WidgetList },
    errors: [401, 403],
  },
  createWidget: {
    operationId: 'createWidget',
    method: 'post',
    path: '/api/ecosystem/widgets',
    summary: 'Create a widget; at least one exact site address is required',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    body: CreateWidgetRequest,
    response: { status: 201, schema: WidgetView },
    errors: [400, 401, 403, 422],
  },
  updateWidget: {
    operationId: 'updateWidget',
    method: 'patch',
    path: '/api/ecosystem/widgets/{widgetId}',
    summary: "Change a widget's allowed sites, amounts switch or status",
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: WidgetParams,
    body: UpdateWidgetRequest,
    response: { status: 200, schema: WidgetView },
    errors: [400, 401, 403, 404, 422],
  },
  deleteWidget: {
    operationId: 'deleteWidget',
    method: 'delete',
    path: '/api/ecosystem/widgets/{widgetId}',
    summary: 'Remove a widget; embedded copies stop rendering',
    tags: ['ecosystem'],
    auth: true,
    idempotent: true,
    params: WidgetParams,
    response: { status: 200, schema: WidgetView },
    errors: [401, 403, 404],
  },
  getWidgetContent: {
    operationId: 'getWidgetContent',
    method: 'get',
    path: '/api/ecosystem/widgets/{widgetId}/content',
    summary: 'What the signed-in viewer sees in this widget, if the host site is allowed',
    tags: ['ecosystem'],
    auth: true,
    params: WidgetParams,
    response: { status: 200, schema: WidgetContent },
    errors: [401, 403, 404, 409],
  },
} as const satisfies Record<string, Endpoint>;
