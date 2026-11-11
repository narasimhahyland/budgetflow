import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import type { EventDetail, Person } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  BudgetBar,
  type BudgetBarSegment,
  DateOnlyPipe,
  DateTimePipe,
  DiscussionBox,
  formatMoney,
  LoadState,
  Money,
  SpendStatus,
} from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatCategoryTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { DocumentsPanel } from './documents-panel';
import { EventTabs } from './event-tabs';
import { initials, label } from './labels';
import { toMinor } from './money-input';

type Tab = 'overview' | 'participants' | 'funding' | 'commitments' | 'documents' | 'activity';

/** The overview's own views, one row below the event sections every event page shares. */
const VIEWS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Summary' },
  { id: 'participants', label: 'Participants' },
  { id: 'funding', label: 'Budget and funding' },
  { id: 'commitments', label: 'Commitments' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
];

interface SourceRow {
  id: string;
  budgetName: string;
  ownerName: string | null;
  own: boolean;
  ref: string;
  mode: string;
  amount: { amountMinor: number; currency: string };
  status: string;
  pending: boolean;
  contributionId: string | null;
}
type Panel = 'contribution' | 'commit' | 'participants' | 'cancel' | null;

/** Screen 46 (with 47 participants, 49 cost split, 51 commitments, 52 documents): one place for an event's money. */
@Component({
  selector: 'bf-event-detail-page',
  imports: [
    BudgetBar,
    DateOnlyPipe,
    DateTimePipe,
    DecimalPipe,
    DiscussionBox,
    DocumentsPanel,
    EventTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatAvatar,
    SatCategoryTag,
    SatImportantButton,
    SatStatusTag,
    SpendStatus,
  ],
  templateUrl: './event-detail.page.html',
  styles: `
    .bf-subtabs {
      margin-top: -4px;
    }

    .bf-tab-count {
      margin-inline-start: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      font-variant-numeric: tabular-nums;
    }

    .bf-lines {
      display: inline-flex;
      flex-direction: column;
      gap: 2px;
      min-width: 200px;
    }

    .bf-lines__row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .bf-wrap {
      white-space: normal;
    }

    .bf-timeline__empty {
      padding-inline-start: 0;
      border-inline-start: 0;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly label = label;
  protected readonly initials = initials;
  protected readonly views = VIEWS;
  readonly eventId = input.required<string>();
  protected readonly tab = signal<Tab>('overview');
  protected readonly panel = signal<Panel>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly surplus = signal<
    { budgetName: string; amount: { amountMinor: number; currency: string } }[]
  >([]);

  protected readonly event = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEvent({ params })),
  });
  protected readonly activity = resource({
    params: () => (this.tab() === 'activity' ? { eventId: this.eventId() } : undefined),
    loader: ({ params }) => data(this.api.eventActivity({ params })),
  });
  protected readonly giverQuery = signal('');
  protected readonly candidates = resource({
    params: () =>
      this.panel() === 'contribution'
        ? {
            eventId: this.eventId(),
            ...(this.giverQuery().trim().length > 1 ? { q: this.giverQuery().trim() } : {}),
          }
        : undefined,
    loader: ({ params }) => data(this.api.candidateGivingBudgets({ query: params })),
  });

  protected readonly e = computed(() => valueOf(this.event));
  protected readonly can = (action: EventDetail['allowedActions'][number]) =>
    this.e()?.allowedActions.includes(action) ?? false;
  protected readonly fundedMinor = computed(() =>
    this.e()
      ? this.e()!.funding.ownFunds.amountMinor + this.e()!.funding.contributions.amountMinor
      : 0,
  );
  protected readonly fundedPct = computed(() => {
    const e = this.e();
    return e && e.estimate.amountMinor > 0
      ? Math.min(100, Math.round((this.fundedMinor() * 100) / e.estimate.amountMinor))
      : 0;
  });
  protected readonly splitBy = signal<'location' | 'entity' | 'cost_center'>('location');
  protected readonly splitRows = computed(() => {
    const s = this.e()?.splits;
    if (!s) return [];
    return this.splitBy() === 'location'
      ? s.byLocation
      : this.splitBy() === 'entity'
        ? s.byEntity
        : s.byCostCenter;
  });
  protected readonly participantsCount = computed(() => this.e()?.participantCount ?? 0);
  /** The ROI scorecard (54b) opens once the event is completed and is final at closed. */
  protected readonly showScorecard = computed(() =>
    ['completed', 'reconciling', 'closed'].includes(this.e()?.status ?? ''),
  );

  // Request contribution form
  protected giverBudgetId = '';
  protected contributionAmount = '';
  protected contributionMode: 'earmark' | 'transfer' = 'earmark';
  protected contributionPurpose = '';
  // Commitment form
  protected commitDescription = '';
  protected commitAmount = '';
  protected commitCurrency = '';
  // Participants
  protected readonly personQuery = signal('');
  protected readonly people = resource({
    params: () =>
      this.panel() === 'participants' && this.personQuery().trim().length > 1
        ? { q: this.personQuery().trim(), limit: 8 }
        : undefined,
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });
  protected readonly participantsList = resource({
    params: () =>
      this.tab() === 'participants'
        ? { eventId: this.eventId(), v: this.event.value()?.participantCount }
        : undefined,
    loader: ({ params }) =>
      data(this.api.listEventParticipants({ params: { eventId: params.eventId } })),
  });
  protected cancelReason = '';

  protected readonly selectedCandidate = computed(() =>
    valueOf(this.candidates)?.items.find((c) => c.budgetId === this.giverBudgetId),
  );

  protected readonly participantColumns = computed(() =>
    this.can('add_participants')
      ? ['name', 'location', 'entity', 'costCenter', 'share', 'actions']
      : ['name', 'location', 'entity', 'costCenter', 'share'],
  );
  protected readonly missingCostCenters = computed(
    () => (valueOf(this.participantsList)?.items ?? []).filter((p) => p.missingCostCenter).length,
  );

  /** Approved sources and contributions still waiting for a decision, in one table. */
  protected readonly sourceRows = computed<SourceRow[]>(() => {
    const e = this.e();
    if (!e) return [];
    const approved = e.sources.map((s) => ({
      id: s.id,
      budgetName: s.originBudgetName,
      ownerName: s.ownerName ?? null,
      own: s.kind === 'own',
      ref: s.contributionRef ?? '',
      mode: s.mode,
      amount: s.funded,
      status: s.status === 'returned' ? 'settled' : 'earmarked',
      pending: false,
      contributionId: s.contributionId,
    }));
    const pending = e.contributions
      .filter((c) => c.status === 'pending_approval' || c.status === 'submitted')
      .map((c) => ({
        id: c.id,
        budgetName: c.giverBudgetName,
        ownerName: c.giverOwnerName ?? null,
        own: false,
        ref: c.ref,
        mode: c.mode,
        amount: c.requested,
        status: c.status,
        pending: true,
        contributionId: c.id,
      }));
    return [...approved, ...pending];
  });

  /** Section 10: what the cap has committed and what it can still commit, as the API reports. */
  protected readonly commitmentSegments = computed<BudgetBarSegment[]>(() => {
    const f = this.e()?.funding;
    if (!f) return [];
    return [
      { bucket: 'encumbered', amountMinor: f.committed.amountMinor, label: 'Committed' },
      {
        bucket: 'available',
        amountMinor: f.available.amountMinor,
        label: "Available under this event's rules",
      },
    ];
  });

  protected viewCount(e: EventDetail, view: Tab): number {
    if (view === 'participants') return e.participantCount;
    if (view === 'commitments') return e.commitments.length;
    if (view === 'documents') return e.documents.length;
    return 0;
  }
  protected readonly sourceColumns = ['source', 'owner', 'type', 'amount', 'status'];
  protected readonly commitmentColumns = [
    'description',
    'status',
    'amount',
    'budgetAmount',
    'lines',
    'actions',
  ];

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
  }

  protected open(p: Panel): void {
    this.failure.set('');
    if (p === 'commit') this.commitCurrency = this.e()?.currency ?? 'USD';
    this.panel.set(this.panel() === p ? null : p);
  }

  private async run(label: string, call: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      if (done) this.snack.open(done, undefined, { duration: 4000 });
      this.panel.set(null);
      this.event.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected transition(verb: 'submit' | 'confirm-funding' | 'start' | 'complete'): void {
    const params = { eventId: this.eventId() };
    const calls = {
      submit: () => data(this.api.submitEvent({ params, body: {} })),
      'confirm-funding': () => data(this.api.confirmEventFunding({ params, body: {} })),
      start: () => data(this.api.startEvent({ params, body: {} })),
      complete: () => data(this.api.completeEvent({ params, body: {} })),
    };
    const done = {
      submit: 'Submitted for approval',
      'confirm-funding': 'Funding confirmed',
      start: 'Event started',
      complete: 'Event completed',
    };
    void this.run('Could not update the event', calls[verb], done[verb]);
  }

  protected close(): void {
    void this.run(
      'Could not close the event',
      async () => {
        const r = await data(
          this.api.closeEvent({ params: { eventId: this.eventId() }, body: {} }),
        );
        this.surplus.set(
          r.surplusReturns.map((s) => ({ budgetName: s.budgetName, amount: s.amount })),
        );
      },
      'Event closed; surplus returned to each contributor',
    );
  }

  protected cancel(): void {
    void this.run(
      'Could not cancel the event',
      () =>
        data(
          this.api.cancelEvent({
            params: { eventId: this.eventId() },
            body: { reason: this.cancelReason.trim() || undefined },
          }),
        ),
      'Event cancelled; funding returned',
    );
  }

  protected requestContribution(): void {
    const ccy = this.e()!.currency;
    const amount = toMinor(this.contributionAmount, ccy);
    if (
      !this.giverBudgetId ||
      !amount ||
      amount <= 0 ||
      this.contributionPurpose.trim().length < 3
    ) {
      this.failure.set('Choose a budget, an amount above zero and a purpose.');
      return;
    }
    void this.run('Could not send the request', async () => {
      const c = await data(
        this.api.createContribution({
          body: {
            eventId: this.eventId(),
            giverBudgetId: this.giverBudgetId,
            amount: { amountMinor: amount, currency: ccy },
            mode: this.contributionMode,
            purpose: this.contributionPurpose.trim(),
          },
        }),
      );
      this.contributionAmount = '';
      this.contributionPurpose = '';
      this.giverBudgetId = '';
      this.snack.open(`Sent ${c.ref} to ${c.giverOwnerName ?? 'the giving director'}`, undefined, {
        duration: 4000,
      });
    });
  }

  protected commit(): void {
    const amount = toMinor(this.commitAmount, this.commitCurrency);
    if (!amount || amount <= 0 || this.commitDescription.trim().length < 3) {
      this.failure.set('Give a description and an amount above zero.');
      return;
    }
    void this.run(
      'Could not commit the spend',
      () =>
        data(
          this.api.createEventCommitment({
            params: { eventId: this.eventId() },
            body: {
              description: this.commitDescription.trim(),
              amount: { amountMinor: amount, currency: this.commitCurrency },
            },
          }),
        ),
      'Spend committed against the event funding',
    );
  }

  protected release(commitmentId: string): void {
    void this.run(
      'Could not release the commitment',
      () =>
        data(
          this.api.releaseEventCommitment({
            params: { eventId: this.eventId(), commitmentId },
            body: { reason: 'Released by the organizer' },
          }),
        ),
      'Released back to the event funding',
    );
  }

  protected addPerson(p: Person): void {
    void this.run(
      'Could not add the participant',
      async () => {
        await data(
          this.api.addEventParticipants({
            params: { eventId: this.eventId() },
            body: { personIds: [p.id] },
          }),
        );
        this.personQuery.set('');
        this.participantsList.reload();
      },
      `Added ${p.displayName}`,
    );
  }

  protected removeParticipant(id: string): void {
    void this.run('Could not remove the participant', async () => {
      await data(
        this.api.removeEventParticipant({ params: { eventId: this.eventId(), participantId: id } }),
      );
      this.participantsList.reload();
    });
  }

  protected requestFunds(): void {
    const e = this.e()!;
    void this.router.navigate(['/requests/new'], {
      queryParams: { kind: 'additional_fund', eventId: e.id, budgetId: e.homeBudgetId },
    });
  }
}
