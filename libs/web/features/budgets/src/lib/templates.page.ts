import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ProgramTemplate, UpsertProgramTemplateRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_INTERACTIVE_CARD_IMPORTS } from '@hylandsoftware/satori-ui/interactive-card';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, toMajor, toMinor, valueOf } from './api';

interface Draft {
  id: string | null;
  code: string;
  name: string;
  driver: 'fixed' | 'per_head';
  description: string;
  rate: string;
  eligibleTypes: ('employee' | 'contractor' | 'intern')[];
  prorate: boolean;
  categoryCode: string;
  thresholds: number[];
}

const toDraft = (t: ProgramTemplate | null): Draft => ({
  id: t?.id ?? null,
  code: t?.code ?? '',
  name: t?.name ?? '',
  driver: t?.driver ?? 'per_head',
  description: t?.defaults.description ?? '',
  rate: t?.defaults.rateMinor ? toMajor(t.defaults.rateMinor) : '',
  eligibleTypes: [...(t?.defaults.eligibleTypes ?? ['employee'])],
  prorate: t?.defaults.prorate ?? true,
  categoryCode: t?.defaults.categoryCode ?? '',
  thresholds: [...(t?.defaults.alertThresholdsPct ?? [50, 80, 100])],
});

/** Screen 20b: reusable program setups (driver, rate, eligibility, category, alert thresholds). */
@Component({
  selector: 'bf-templates-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_INTERACTIVE_CARD_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-tpl {
      display: grid;
      grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 900px) {
      .bf-tpl {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-tpl__list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 12px;
      list-style: none;
    }
    .bf-tpl__item {
      display: block;
      width: 100%;
      text-align: start;
    }
    .bf-tpl__label {
      display: block;
      margin: 16px 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .bf-tpl__meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-field {
      width: 100%;
    }
    .bf-group {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
  `,
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Program templates</h1>
        <p class="bf-page__subtitle">Reusable setups for new budgets. Amounts in USD.</p>
      </div>
      @if (canManage()) {
        <div class="bf-page__actions">
          <button mat-flat-button type="button" (click)="startNew()">
            <mat-icon svgIcon="plus_small" aria-hidden="true" />New template
          </button>
        </div>
      }
    </header>
    <bf-load-state
      [loading]="list.isLoading()"
      [error]="list.error()"
      what="program templates"
      (retry)="list.reload()"
    />
    @if (list.hasValue()) {
      <div class="bf-tpl">
        <section class="bf-card" aria-label="Templates">
          <div class="bf-card__header">
            <h2 class="bf-card__title">{{ items().length }} templates</h2>
          </div>
          <ul class="bf-tpl__list">
            @for (t of items(); track t.id) {
              <li>
                <button
                  sat-interactive-card
                  type="button"
                  class="bf-tpl__item"
                  [active]="draft().id === t.id"
                  [border]="true"
                  (click)="select(t)"
                  [attr.data-testid]="'template-' + t.code"
                >
                  <span satInteractiveCardTitle>{{ t.name }}</span>
                  <span satInteractiveCardSubtitle>{{ t.defaults.description ?? '' }}</span>
                  <sat-interactive-card-content>
                    <span class="bf-tpl__meta">
                      <span>{{ usedBy(t.budgetCount) }}</span>
                      <sat-category-tag category="gray">{{
                        t.driver === 'per_head' ? 'Per head' : 'Fixed'
                      }}</sat-category-tag>
                    </span>
                  </sat-interactive-card-content>
                </button>
              </li>
            }
          </ul>
        </section>
        <section class="bf-card" aria-label="Template">
          <div class="bf-card__header">
            <h2 class="bf-card__title">{{ draft().id ? draft().name : 'New template' }}</h2>
            @if (draft().driver === 'per_head' && toMinor(draft().rate)) {
              <sat-category-tag category="gray"
                ><bf-money [amountMinor]="toMinor(draft().rate) ?? 0" currency="USD" /> per eligible
                head</sat-category-tag
              >
            }
          </div>
          <div class="bf-card__body">
            <div class="bf-form" style="padding: 0">
              <mat-form-field
                ><mat-label>Code</mat-label
                ><input
                  matInput
                  [ngModel]="draft().code"
                  (ngModelChange)="patch({ code: $event })"
                  [disabled]="!canManage()"
              /></mat-form-field>
              <mat-form-field
                ><mat-label>Name</mat-label
                ><input
                  matInput
                  [ngModel]="draft().name"
                  (ngModelChange)="patch({ name: $event })"
                  [disabled]="!canManage()"
              /></mat-form-field>
              <mat-form-field class="bf-form__wide"
                ><mat-label>Description</mat-label
                ><input
                  matInput
                  [ngModel]="draft().description"
                  (ngModelChange)="patch({ description: $event })"
                  [disabled]="!canManage()"
              /></mat-form-field>
            </div>
            <p class="bf-group">Allocation driver</p>
            <mat-button-toggle-group
              [value]="draft().driver"
              (change)="patch({ driver: $event.value })"
              [disabled]="!canManage()"
              aria-label="Driver"
            >
              <mat-button-toggle value="per_head">Per head</mat-button-toggle>
              <mat-button-toggle value="fixed">Fixed amount</mat-button-toggle>
            </mat-button-toggle-group>
            @if (draft().driver === 'per_head') {
              <div class="bf-form" style="padding: 12px 0 0">
                <mat-form-field
                  ><mat-label>Rate per eligible head (USD)</mat-label
                  ><input
                    matInput
                    inputmode="decimal"
                    [ngModel]="draft().rate"
                    (ngModelChange)="patch({ rate: $event })"
                    [disabled]="!canManage()"
                    data-testid="template-rate"
                /></mat-form-field>
                <mat-form-field
                  ><mat-label>Eligible employment types</mat-label>
                  <mat-select
                    multiple
                    [ngModel]="draft().eligibleTypes"
                    (ngModelChange)="patch({ eligibleTypes: $event })"
                    [disabled]="!canManage()"
                  >
                    <mat-option value="employee">Employees</mat-option>
                    <mat-option value="intern">Interns</mat-option>
                    <mat-option value="contractor">Contractors</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field
                  ><mat-label>Proration</mat-label>
                  <mat-select
                    [ngModel]="draft().prorate"
                    (ngModelChange)="patch({ prorate: $event })"
                    [disabled]="!canManage()"
                  >
                    <mat-option [value]="true">Joiners and leavers prorated</mat-option>
                    <mat-option [value]="false">Whole heads</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
            }
            <p class="bf-group">Category and alerts</p>
            <div class="bf-form" style="padding: 0">
              <mat-form-field
                ><mat-label>Category</mat-label>
                <mat-select
                  [ngModel]="draft().categoryCode"
                  (ngModelChange)="patch({ categoryCode: $event })"
                  [disabled]="!canManage()"
                >
                  <mat-option value="">None</mat-option>
                  @for (c of categories(); track c.code) {
                    <mat-option [value]="c.code">{{ c.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <span class="bf-tpl__label" id="tpl-thresholds">Alert thresholds</span>
            <mat-button-toggle-group
              multiple
              [value]="draft().thresholds"
              (change)="patch({ thresholds: $event.value })"
              [disabled]="!canManage()"
              aria-labelledby="tpl-thresholds"
            >
              @for (t of [50, 80, 90, 100]; track t) {
                <mat-button-toggle [value]="t">{{ t }}%</mat-button-toggle>
              }
            </mat-button-toggle-group>
            <sat-banner variant="info" style="margin-top: 16px"
              ><sat-banner-message
                >Changing a template never changes budgets already created from
                it.</sat-banner-message
              ></sat-banner
            >
            @if (failure()) {
              <sat-banner variant="important"
                ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
              >
            }
            @if (canManage()) {
              <div class="bf-form__actions" style="padding: 16px 0 0">
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy()"
                  (click)="save()"
                  data-testid="save-template"
                >
                  Save template
                </button>
              </div>
            } @else {
              <p class="bf-card__hint">Finance administrators maintain the templates.</p>
            }
          </div>
        </section>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly toMinor = toMinor;
  protected readonly canManage = computed(() => this.session.can('master_data.manage'));
  protected readonly list = resource({
    loader: async () => (await data(this.api.listProgramTemplates({}))).items,
  });
  protected readonly items = computed(() => valueOf(this.list) ?? []);
  private readonly cats = resource({
    loader: async () => (await data(this.api.listCategories({}))).items,
  });
  protected readonly categories = computed(() => valueOf(this.cats) ?? []);
  protected readonly draft = signal<Draft>(toDraft(null));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly snack = inject(MatSnackBar);
  protected usedBy(n: number): string {
    return n === 0 ? 'Not used yet' : n === 1 ? 'Used by 1 budget' : `Used by ${n} budgets`;
  }

  constructor() {
    effect(() => {
      const first = this.items()[0];
      if (first && !this.draft().id && !this.draft().code) this.draft.set(toDraft(first));
    });
  }

  protected select(t: ProgramTemplate): void {
    this.draft.set(toDraft(t));
    this.failure.set(null);
  }
  protected startNew(): void {
    this.draft.set({ ...toDraft(null), code: 'NEW-PROGRAM', name: 'New program' });
  }
  protected patch(p: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    this.busy.set(true);
    this.failure.set(null);
    const body: UpsertProgramTemplateRequest = {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      driver: d.driver,
      defaults: {
        ...(d.description.trim() ? { description: d.description.trim() } : {}),
        ...(d.driver === 'per_head' && toMinor(d.rate)
          ? { rateMinor: toMinor(d.rate)!, eligibleTypes: d.eligibleTypes, prorate: d.prorate }
          : {}),
        ...(d.categoryCode ? { categoryCode: d.categoryCode } : {}),
        alertThresholdsPct: [...d.thresholds].sort((a, b) => a - b),
      },
    };
    try {
      const t = d.id
        ? await data(this.api.updateProgramTemplate({ params: { templateId: d.id }, body }))
        : await data(this.api.createProgramTemplate({ body }));
      this.draft.set(toDraft(t));
      this.snack.open('Template saved.', undefined, { duration: 6000 });
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
