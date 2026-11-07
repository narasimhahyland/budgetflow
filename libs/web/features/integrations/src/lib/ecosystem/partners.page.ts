import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { MarketplaceCategory, PartnerSyncResult, PartnerView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';
import type { Tone } from '../labels';
import { LoadState } from '../load-state';
import { byRank, byText, ordered } from '../order';
import { EcosystemNav } from './ecosystem-nav';
import {
  MARKETPLACE_CATEGORY_LABELS,
  PARTNER_MODE_LABELS,
  PARTNER_STATUS_LABELS,
  PARTNER_STATUS_TONES,
} from './labels';

/** The two vendor statuses a partner may be linked to; anything else is refused by the API. */
const VENDOR_OK = ['approved', 'preferred'];

/**
 * Screen 092d, partner administration. Partners are fictional sample data in this build, so the
 * page says so where it would otherwise read as a list of real companies with real prices.
 */
@Component({
  selector: 'bf-marketplace-partners-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    EcosystemNav,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './partners.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketplacePartnersPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly columns = [
    'name',
    'categories',
    'vendor',
    'mode',
    'offers',
    'status',
    'actions',
  ];

  protected readonly partners = resource({ loader: () => data(this.api.listPartners({})) });
  /** Only asked for when the reader may read master data; a refusal we expect is not a request. */
  protected readonly vendors = resource({
    params: () => (this.session.can('master_data.manage') ? {} : undefined),
    loader: () => data(this.api.listVendors({ query: { limit: 200 } })),
  });

  protected readonly canManage = computed(() => valueOf(this.partners)?.canManage ?? false);

  /** Partners that cannot take bookings first, so the thing to fix is at the top. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.partners)?.items ?? [],
      byRank<PartnerView>((p) => (p.status === 'enabled' ? 1 : 0)),
      byText<PartnerView>((p) => p.name),
    ),
  );

  protected readonly approvedVendors = computed(() =>
    [...(valueOf(this.vendors)?.items ?? [])]
      .filter((v) => VENDOR_OK.includes(v.status))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
  );
  protected readonly canLinkVendor = computed(() => this.approvedVendors().length > 0);

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly synced = signal<(PartnerSyncResult & { name: string }) | null>(null);

  protected categoryLabel(category: MarketplaceCategory): string {
    return MARKETPLACE_CATEGORY_LABELS[category];
  }

  protected statusLabel(status: PartnerView['status']): string {
    return PARTNER_STATUS_LABELS[status];
  }

  protected statusTone(status: PartnerView['status']): Tone {
    return PARTNER_STATUS_TONES[status];
  }

  protected modeLabel(mode: PartnerView['mode']): string {
    return PARTNER_MODE_LABELS[mode];
  }

  /** A partner with no Approved or Preferred vendor cannot be enabled, and the API refuses it. */
  protected blockedReason(p: PartnerView): string | null {
    if (p.vendorId && VENDOR_OK.includes(p.vendorStatus ?? '')) return null;
    if (!p.vendorId) return 'Not linked to a vendor, so it cannot be enabled or take bookings.';
    return `${p.vendorName} is not an Approved or Preferred vendor, so this partner cannot take bookings.`;
  }

  protected async setStatus(p: PartnerView, status: PartnerView['status']): Promise<void> {
    await this.act(async () => {
      await data(this.api.updatePartner({ params: { partnerId: p.id }, body: { status } }));
      this.notice.set(
        status === 'enabled'
          ? `${p.name} is enabled. Its offers show in the marketplace.`
          : `${p.name} is paused. Its offers are hidden; bookings already placed carry on.`,
      );
      this.partners.reload();
    });
  }

  protected async setVendor(p: PartnerView, vendorId: string): Promise<void> {
    await this.act(async () => {
      await data(this.api.updatePartner({ params: { partnerId: p.id }, body: { vendorId } }));
      this.notice.set(`${p.name} is linked to its vendor record.`);
      this.partners.reload();
    });
  }

  protected async setMode(p: PartnerView, mode: PartnerView['mode']): Promise<void> {
    await this.act(async () => {
      await data(this.api.updatePartner({ params: { partnerId: p.id }, body: { mode } }));
      this.notice.set(`${p.name} now runs in ${this.modeLabel(mode)} mode.`);
      this.partners.reload();
    });
  }

  protected async sync(p: PartnerView): Promise<void> {
    await this.act(async () => {
      const result = await data(this.api.syncPartner({ params: { partnerId: p.id } }));
      this.synced.set({ ...result, name: p.name });
      this.partners.reload();
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    this.synced.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
