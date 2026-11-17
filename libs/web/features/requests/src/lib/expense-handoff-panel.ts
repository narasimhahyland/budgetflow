import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ExpenseHandoffView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe, formatMoney, Money } from '@bf/web/ui';
import { NgTemplateOutlet } from '@angular/common';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';

const STATUS: Record<string, { label: string; tone: 'info' | 'success' | 'neutral' }> = {
  draft_created: { label: 'Draft created', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
};

/**
 * 117a: once a request is approved, its requester creates one draft expense in the company's
 * expense tool with the request's fields already filled, and submits it there. The panel lists the
 * fields before anything is sent, then shows the draft's progress synced back from the tool. With
 * no tool connected the same fields are offered to copy. The hand-off moves no money.
 */
@Component({
  selector: 'bf-expense-handoff-panel',
  imports: [
    DateOnlyPipe,
    DateTimePipe,
    MatButtonModule,
    Money,
    NgTemplateOutlet,
    SAT_BANNER_IMPORTS,
    SatGhost,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <section class="bf-card" aria-labelledby="handoff-title" data-testid="expense-handoff">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="handoff-title">Expense</h2>
      </div>
      @if (view.isLoading() && !view.hasValue()) {
        <div class="bf-section"><sat-ghost class="bf-ghost" /></div>
      } @else if (view.error()) {
        <div class="bf-section">
          <sat-banner variant="important"
            ><sat-banner-message>{{ message(view.error()) }}</sat-banner-message></sat-banner
          >
        </div>
      } @else if (v(); as h) {
        <div class="bf-section">
          @if (failure()) {
            <sat-banner variant="important" class="bf-banner" data-testid="handoff-error">
              <sat-banner-message
                >{{ failure() }}. You can copy the details below instead.</sat-banner-message
              >
            </sat-banner>
          }
          @switch (h.availability) {
            @case ('not_approved') {
              <p class="bf-note">Available after approval.</p>
            }
            @case ('ready') {
              @if (!confirming()) {
                <p>We'll fill in the event code, cost center and amount for you.</p>
                <button
                  mat-flat-button
                  satImportantButton
                  type="button"
                  (click)="confirming.set(true)"
                  data-testid="handoff-start"
                >
                  Create expense in {{ h.tool!.displayName }}
                </button>
              } @else {
                <p>
                  These fields go to {{ h.tool!.displayName }}. A draft is created for you in
                  {{ h.tool!.displayName }}. You submit it there.
                </p>
                <ng-container *ngTemplateOutlet="fields; context: { $implicit: h }" />
                <div class="bf-actions">
                  <button mat-button type="button" (click)="confirming.set(false)">Cancel</button>
                  <button
                    mat-flat-button
                    satImportantButton
                    type="button"
                    [disabled]="busy()"
                    (click)="create()"
                    data-testid="handoff-create"
                  >
                    Create draft expense
                  </button>
                </div>
              }
            }
            @case ('created') {
              @let d = h.handoff!;
              <p data-testid="handoff-status">
                <sat-status-tag [status]="tone(d.status)">{{ label(d.status) }}</sat-status-tag>
                Draft created in {{ h.tool?.displayName }},
                {{ d.createdAt | bfDateTime: session.timezone() }} ({{ d.externalId }}).
              </p>
              @if (d.history.length > 1) {
                <ul class="bf-list" aria-label="Expense progress">
                  @for (s of d.history; track $index) {
                    <li>{{ label(s.status) }}: {{ s.at | bfDate: session.timezone() }}</li>
                  }
                </ul>
              }
              @if (d.claimedAmount; as c) {
                <p data-testid="handoff-claimed">
                  Claimed <bf-money [amountMinor]="c.amountMinor" [currency]="c.currency" />
                  @if (d.differenceMinor !== null && d.differenceMinor !== 0) {
                    , {{ money(abs(d.differenceMinor), c.currency) }}
                    {{ d.differenceMinor > 0 ? 'more' : 'less' }} than approved
                  }
                </p>
                @if ((d.differenceMinor ?? 0) > 0) {
                  <sat-banner variant="warning" class="bf-banner">
                    <sat-banner-message
                      >Claim is {{ money(d.differenceMinor!, c.currency) }} more than approved. Your
                      approver will be asked to accept the difference.</sat-banner-message
                    >
                  </sat-banner>
                }
              }
            }
            @case ('not_allowed') {
              <p class="bf-note">The person who made the request creates its expense.</p>
            }
          }
          @if (h.availability === 'not_connected' || failure()) {
            <p>
              @if (failure()) {
                Copy the details into your expense claim instead.
              } @else {
                No expense tool is connected. Copy the details into your expense claim.
              }
            </p>
            <ng-container *ngTemplateOutlet="fields; context: { $implicit: h }" />
            <button mat-stroked-button type="button" (click)="copy(h)" data-testid="handoff-copy">
              Copy all
            </button>
          }
        </div>
      }
    </section>

    <ng-template #fields let-h>
      <dl class="bf-facts" aria-label="Expense fields">
        <div>
          <dt>Request</dt>
          <dd>{{ h.fields.requestRef }}</dd>
        </div>
        <div>
          <dt>Expense type</dt>
          <dd>{{ h.fields.expenseType ?? 'Choose in the tool' }}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            <bf-money
              [amountMinor]="h.fields.amount.amountMinor"
              [currency]="h.fields.amount.currency"
            />
          </dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{{ h.fields.date | bfDate: 'UTC' }}</dd>
        </div>
        <div>
          <dt>Cost center</dt>
          <dd>{{ h.fields.costCenterCode ?? 'Not set' }}</dd>
        </div>
        <div>
          <dt>Event code</dt>
          <dd>{{ h.fields.eventCode ?? 'None' }}</dd>
        </div>
        <div>
          <dt>Merchant</dt>
          <dd>{{ h.fields.merchant ?? 'Not known' }}</dd>
        </div>
      </dl>
    </ng-template>
  `,
  styles: `
    .bf-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .bf-ghost {
      display: block;
      height: 64px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpenseHandoffPanel {
  readonly requestId = input.required<string>();

  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** One key per hand-off attempt: a double click or a retry creates one draft. */
  private key = crypto.randomUUID();

  protected readonly view = resource({
    params: () => ({ requestId: this.requestId() }),
    loader: ({ params }) => data(this.api.getExpenseHandoff({ params })),
  });
  protected readonly v = () => valueOf(this.view) as ExpenseHandoffView | undefined;

  protected label = (s: string) => STATUS[s]?.label ?? s;
  protected tone = (s: string) => STATUS[s]?.tone ?? 'neutral';
  protected money = (minor: number, currency: string) => formatMoney(minor, currency);
  protected abs = Math.abs;
  protected message = errorMessage;

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const created = await data(
        this.api.createExpenseHandoff({
          params: { requestId: this.requestId() },
          body: {},
          idempotencyKey: this.key,
        }),
      );
      this.view.set(created);
      this.confirming.set(false);
      this.snack.open(
        `Draft expense created in ${created.tool?.displayName ?? 'the tool'}.`,
        'OK',
        {
          duration: 4000,
        },
      );
    } catch (e) {
      this.failure.set(errorMessage(e).replace(/\.$/, ''));
      this.confirming.set(false);
      this.key = crypto.randomUUID();
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(h: ExpenseHandoffView): Promise<void> {
    const f = h.fields;
    const text = [
      `Request: ${f.requestRef}`,
      `Description: ${f.title}`,
      `Expense type: ${f.expenseType ?? ''}`,
      `Amount: ${formatMoney(f.amount.amountMinor, f.amount.currency)}`,
      `Date: ${f.date}`,
      `Cost center: ${f.costCenterCode ?? ''}`,
      `Event code: ${f.eventCode ?? ''}`,
      `Merchant: ${f.merchant ?? ''}`,
    ].join('\n');
    await navigator.clipboard?.writeText(text);
    this.snack.open('Details copied.', 'OK', { duration: 3000 });
  }
}
