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
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { LegalHold, LegalHoldScopeKind, RetentionPolicy, RetentionRun } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { PendingChange, ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const ACTION_LABEL: Record<string, string> = {
  delete: 'Deleted',
  anonymise: 'Personal details anonymised',
  archive: 'Archived read-only',
  never: 'Never removed',
} satisfies Record<RetentionPolicy['action'], string>;

const SCOPE_LABEL: Record<string, string> = {
  person: 'A person',
  event: 'An event',
  budget: 'A budget',
  date_range: 'A range of dates',
} satisfies Record<LegalHoldScopeKind, string>;

type PolicyRow = RetentionPolicy & { detail: boolean };

type HoldDecision = 'confirm' | 'decline' | 'release';

const HOLD_DECISION_LABEL: Record<HoldDecision, string> = {
  confirm: 'Confirm the hold',
  decline: 'Decline the hold',
  release: 'Release the hold',
};

/**
 * Screen 111: how long each kind of data is kept, the legal holds that stop anything in their scope
 * being destroyed, and the preview-then-apply retention run.
 *
 * The honesty rules this screen carries:
 * - every period is a provisional default pending finance and legal sign-off, never an approved
 *   legal position;
 * - `automation: 'manual'` means nothing deletes the category today, so the row says so rather than
 *   implying a job is running;
 * - a change that shortens a financial category comes back waiting, and the row keeps showing the
 *   period still in force;
 * - a hold is only in force once a second person has confirmed it, and releasing it makes the
 *   records removable again.
 */
@Component({
  selector: 'bf-retention-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    PendingChange,
    ReasonField,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './retention.page.html',
  styleUrls: ['./page.scss', './retention.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RetentionPage {
  protected readonly valueOf = valueOf;
  protected readonly actionLabel = ACTION_LABEL;
  protected readonly scopeLabel = SCOPE_LABEL;
  protected readonly scopeKinds = Object.keys(SCOPE_LABEL) as LegalHoldScopeKind[];
  protected readonly holdDecisionLabel = HOLD_DECISION_LABEL;
  protected readonly policyColumns = [
    'category',
    'period',
    'then',
    'applied',
    'signoff',
    'actions',
  ];
  protected readonly holdColumns = ['scope', 'reason', 'who', 'status', 'actions'];
  protected readonly runColumns = ['started', 'mode', 'summary', 'status', 'actions'];
  protected readonly hasDetail = (_index: number, row: { detail: boolean }): boolean => row.detail;

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly timezone = this.session.timezone;

  protected readonly canEditPolicies = computed(
    () => this.session.can('tenant.settings.manage') || this.session.can('master_data.manage'),
  );
  protected readonly canConfirmPolicy = computed(() => this.session.can('retention.confirm'));
  protected readonly canManageHolds = computed(() => this.session.can('legal_hold.manage'));

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  // Policy editing ---------------------------------------------------------------------------
  protected readonly editing = signal<string | null>(null);
  protected readonly periodDays = signal<string>('');
  protected readonly editReason = signal('');
  protected readonly deciding = signal<{
    category: string;
    changeId: string;
    decision: 'confirm' | 'decline' | 'cancel';
  } | null>(null);
  protected readonly decisionReason = signal('');

  // Legal holds ------------------------------------------------------------------------------
  protected readonly placingHold = signal(false);
  protected readonly holdScope = signal<LegalHoldScopeKind>('event');
  protected readonly holdRefId = signal('');
  protected readonly holdFrom = signal('');
  protected readonly holdTo = signal('');
  protected readonly holdReason = signal('');
  protected readonly holdDeciding = signal<{ holdId: string; decision: HoldDecision } | null>(null);
  protected readonly holdDecisionReason = signal('');

  // Retention run ----------------------------------------------------------------------------
  protected readonly preview = signal<RetentionRun | null>(null);
  protected readonly runReason = signal('');
  protected readonly confirmation = signal('');
  protected readonly applyOpen = signal(false);

  protected readonly policies = resource({
    loader: () => data(this.api.retentionPolicies({})),
  });
  protected readonly holds = resource({ loader: () => data(this.api.legalHolds({})) });
  protected readonly runs = resource({ loader: () => data(this.api.retentionRuns({})) });

  protected readonly policyRows = computed<PolicyRow[]>(() => {
    const editing = this.editing();
    const deciding = this.deciding();
    return (valueOf(this.policies)?.items ?? []).map((p) => ({
      ...p,
      detail:
        p.pendingChange !== null || editing === p.category || deciding?.category === p.category,
    }));
  });

  protected readonly provisionalCount = computed(
    () => this.policyRows().filter((p) => p.signoffStatus === 'provisional').length,
  );
  protected readonly automaticCount = computed(
    () => this.policyRows().filter((p) => p.automation === 'automatic').length,
  );
  protected readonly activeHolds = computed(
    () => (valueOf(this.holds)?.items ?? []).filter((h) => h.status === 'active').length,
  );
  protected readonly waitingHolds = computed(
    () =>
      (valueOf(this.holds)?.items ?? []).filter((h) => h.status === 'pending_confirmation').length,
  );

  protected readonly lastRun = computed(() => (valueOf(this.runs)?.items ?? [])[0] ?? null);

  /** Whether the typed word matches exactly; the API checks it again before anything is removed. */
  protected readonly confirmationValid = computed(() => this.confirmation() === 'DELETE');

  protected readonly previewTotals = computed(() => {
    const run = this.preview();
    if (!run) return null;
    return {
      candidates: run.items.reduce((sum, i) => sum + i.candidateCount, 0),
      held: run.items.reduce((sum, i) => sum + i.skippedHoldCount, 0),
    };
  });

  protected holdStatusTone(hold: LegalHold): 'success' | 'warning' | 'neutral' {
    if (hold.status === 'active') return 'success';
    if (hold.status === 'pending_confirmation') return 'warning';
    return 'neutral';
  }

  protected holdStatusLabel(hold: LegalHold): string {
    switch (hold.status) {
      case 'active':
        return 'In force';
      case 'pending_confirmation':
        return 'Not in force yet';
      case 'declined':
        return 'Declined';
      default:
        return 'Released';
    }
  }

  protected holdStatusNote(hold: LegalHold): string {
    switch (hold.status) {
      case 'active':
        return 'Nothing in this scope is deleted or anonymised while the hold is in force.';
      case 'pending_confirmation':
        return 'Records in this scope are not protected yet. A second person who may manage legal holds has to confirm it, and it cannot be the person who placed it.';
      case 'declined':
        return 'The hold was declined, so records in this scope follow the normal retention periods.';
      default:
        return 'The hold was released, so records in this scope can be removed again.';
    }
  }

  /** The person who placed a hold never confirms it; the API refuses it as well. */
  protected canDecideHold(hold: LegalHold): boolean {
    return (
      this.canManageHolds() &&
      hold.status === 'pending_confirmation' &&
      hold.placedByName !== this.session.me()?.displayName
    );
  }

  protected openEdit(policy: RetentionPolicy): void {
    this.editing.set(policy.category);
    this.periodDays.set(policy.periodDays === null ? '' : String(policy.periodDays));
    this.editReason.set('');
    this.deciding.set(null);
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async savePolicy(policy: RetentionPolicy): Promise<void> {
    const raw = this.periodDays().trim();
    await this.run(async () => {
      const result = await data(
        this.api.updateRetentionPolicy({
          params: { category: policy.category },
          body: {
            periodDays: raw === '' ? null : Number(raw),
            reason: this.editReason(),
          },
        }),
      );
      this.editing.set(null);
      this.notice.set(
        result.applied
          ? `${policy.label} is now kept for ${result.periodDays === null ? 'ever' : `${result.periodDays} days`}.`
          : `${policy.label} is unchanged: ${policy.periodLabel} Your request is waiting for a Finance Controller to confirm it.`,
      );
    });
  }

  protected openDecision(
    policy: RetentionPolicy,
    decision: 'confirm' | 'decline' | 'cancel',
  ): void {
    const change = policy.pendingChange;
    if (!change) return;
    this.deciding.set({ category: policy.category, changeId: change.id, decision });
    this.decisionReason.set('');
    this.editing.set(null);
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async decidePolicy(policy: RetentionPolicy): Promise<void> {
    const open = this.deciding();
    if (!open || open.category !== policy.category) return;
    await this.run(async () => {
      await data(
        this.api.decideRetentionChange({
          params: { changeId: open.changeId },
          body: { decision: open.decision, reason: this.decisionReason() },
        }),
      );
      this.deciding.set(null);
      this.notice.set(
        open.decision === 'confirm'
          ? `${policy.label} now follows the new period.`
          : `The change to ${policy.label} was ${open.decision === 'decline' ? 'declined' : 'withdrawn'}; the period already in force is unchanged.`,
      );
    });
  }

  protected async placeHold(): Promise<void> {
    await this.run(async () => {
      const hold = await data(
        this.api.placeLegalHold({
          body: {
            scopeKind: this.holdScope(),
            scopeRefId: this.holdRefId().trim() || null,
            scopeFrom: this.holdFrom() || null,
            scopeTo: this.holdTo() || null,
            reason: this.holdReason(),
          },
        }),
      );
      this.placingHold.set(false);
      this.holdRefId.set('');
      this.holdFrom.set('');
      this.holdTo.set('');
      this.holdReason.set('');
      this.notice.set(
        `The hold over ${hold.scopeLabel} is not in force yet. Somebody else who may manage legal holds has to confirm it first.`,
      );
    });
  }

  protected openHoldDecision(hold: LegalHold, decision: HoldDecision): void {
    this.holdDeciding.set({ holdId: hold.id, decision });
    this.holdDecisionReason.set('');
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async decideHold(hold: LegalHold): Promise<void> {
    const open = this.holdDeciding();
    if (!open || open.holdId !== hold.id) return;
    await this.run(async () => {
      const updated = await data(
        this.api.decideLegalHold({
          params: { holdId: hold.id },
          body: { decision: open.decision, reason: this.holdDecisionReason() },
        }),
      );
      this.holdDeciding.set(null);
      this.notice.set(
        updated.status === 'active'
          ? `The hold over ${updated.scopeLabel} is in force. Nothing in its scope is deleted or anonymised.`
          : updated.status === 'released'
            ? `The hold over ${updated.scopeLabel} is released. Records in its scope can be removed again.`
            : `The hold over ${updated.scopeLabel} was declined and never came into force.`,
      );
    });
  }

  protected async startPreview(): Promise<void> {
    await this.run(async () => {
      const run = await data(
        this.api.startRetentionRun({
          body: {
            mode: 'dry_run',
            categories: [],
            reason: this.runReason().trim() || 'Preview what the next retention run would remove.',
          },
        }),
      );
      this.preview.set(run);
      this.applyOpen.set(false);
      this.confirmation.set('');
      this.notice.set('This is a preview. Nothing has been removed.');
    });
  }

  protected async applyPreview(): Promise<void> {
    const preview = this.preview();
    if (!preview) return;
    await this.run(async () => {
      const run = await data(
        this.api.startRetentionRun({
          body: {
            mode: 'apply',
            categories: preview.categories,
            dryRunId: preview.id,
            confirmation: this.confirmation(),
            reason: this.runReason().trim() || 'Apply the previewed retention run.',
          },
        }),
      );
      this.preview.set(null);
      this.applyOpen.set(false);
      this.confirmation.set('');
      this.notice.set(run.summary);
    });
  }

  protected discardPreview(): void {
    this.preview.set(null);
    this.applyOpen.set(false);
    this.confirmation.set('');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.policies.reload();
      this.holds.reload();
      this.runs.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
