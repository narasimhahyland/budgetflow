import { ApiProblem, PolicyService, type RequestActor } from '@bf/api/core';
import { ecosystemSurfaces, type Tx } from '@bf/api/db';
import type { AssistantTool, BiDataset, EcosystemSurface, NoCodePlatform } from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_ASSISTANT_TOOLS, DEFAULT_BI_DATASETS } from './catalog';

export interface BiConfig {
  datasets: BiDataset[];
}
export interface AssistantConfig {
  tools: AssistantTool[];
  /** Named assistant apps that may connect; null means any app that can sign in (092c). */
  allowedApps: string[] | null;
}
export interface AutomationConfig {
  /** Platforms the Integration Admin has allowed. Every platform starts Not allowed (092b). */
  platforms: NoCodePlatform[];
}

interface SurfaceRow {
  enabled: boolean;
  config: Record<string, unknown>;
}

export const tenantOf = (actor: RequestActor) => ({
  kind: 'tenant' as const,
  tenantId: actor.tenantId,
});

/**
 * The per-tenant switch and configuration behind each external surface. A surface that is off
 * refuses before any tenant data is read, and the switch is separate from authorization: a reader
 * who may not use a surface is refused even when it is on.
 */
@Injectable()
export class EcosystemSurfacesService {
  constructor(private readonly policy: PolicyService) {}

  canManage(actor: RequestActor): boolean {
    return this.policy.can(actor, 'integration.manage', tenantOf(actor)).allowed;
  }

  canRead(actor: RequestActor): boolean {
    return this.policy.can(actor, 'integration.read', tenantOf(actor)).allowed;
  }

  assertCanManage(actor: RequestActor, what: string): void {
    this.policy.assert(actor, 'integration.manage', tenantOf(actor), what);
  }

  async read(tx: Tx, tenantId: string, surface: EcosystemSurface): Promise<SurfaceRow> {
    const [row] = await tx
      .select({ enabled: ecosystemSurfaces.enabled, config: ecosystemSurfaces.config })
      .from(ecosystemSurfaces)
      .where(and(eq(ecosystemSurfaces.tenantId, tenantId), eq(ecosystemSurfaces.surface, surface)));
    return {
      enabled: row?.enabled ?? false,
      config: (row?.config as Record<string, unknown> | undefined) ?? {},
    };
  }

  async write(
    tx: Tx,
    tenantId: string,
    surface: EcosystemSurface,
    next: { enabled: boolean; config: Record<string, unknown> },
    updatedBy: string | null,
  ): Promise<void> {
    await tx
      .insert(ecosystemSurfaces)
      .values({
        tenantId,
        surface,
        enabled: next.enabled,
        config: next.config,
        updatedBy,
      })
      .onConflictDoUpdate({
        target: [ecosystemSurfaces.tenantId, ecosystemSurfaces.surface],
        set: {
          enabled: next.enabled,
          config: next.config,
          updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  async bi(tx: Tx, tenantId: string): Promise<{ enabled: boolean; config: BiConfig }> {
    const row = await this.read(tx, tenantId, 'bi');
    const datasets = row.config['datasets'];
    return {
      enabled: row.enabled,
      config: {
        datasets: Array.isArray(datasets) ? (datasets as BiDataset[]) : [...DEFAULT_BI_DATASETS],
      },
    };
  }

  async assistants(
    tx: Tx,
    tenantId: string,
  ): Promise<{ enabled: boolean; config: AssistantConfig }> {
    const row = await this.read(tx, tenantId, 'assistants');
    const tools = row.config['tools'];
    const allowedApps = row.config['allowedApps'];
    return {
      enabled: row.enabled,
      config: {
        tools: Array.isArray(tools) ? (tools as AssistantTool[]) : [...DEFAULT_ASSISTANT_TOOLS],
        allowedApps: Array.isArray(allowedApps) ? (allowedApps as string[]) : null,
      },
    };
  }

  async automations(
    tx: Tx,
    tenantId: string,
  ): Promise<{ enabled: boolean; config: AutomationConfig }> {
    const row = await this.read(tx, tenantId, 'automations');
    const platforms = row.config['platforms'];
    return {
      enabled: row.enabled,
      config: { platforms: Array.isArray(platforms) ? (platforms as NoCodePlatform[]) : [] },
    };
  }

  /** Refuses a call to a surface the company has not turned on, before anything is read. */
  assertEnabled(enabled: boolean, title: string): void {
    if (!enabled)
      throw new ApiProblem(
        409,
        'ECOSYSTEM_SURFACE_DISABLED',
        `${title} is turned off for this company.`,
      );
  }
}
