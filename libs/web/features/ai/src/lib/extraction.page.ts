import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ExtractedField, ExtractionResult } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi } from './api';

/**
 * Screen 121a: receipt and quote extraction. Extraction only prefills the form. Fields the model was
 * not confident about are left empty and marked for checking, never guessed, and only the values the
 * person confirms are recorded — the confirmation is what the decision endpoint stores.
 */
@Component({
  selector: 'bf-extraction-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Receipt and quote details</h1>
          <bf-ai-label text="AI-filled" />
        </div>
        <p class="bf-page__subtitle">
          Details read from a verified file, so you do not have to type them. Check them before you
          confirm: the values saved are the ones you confirm, not the ones the model read.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/my/requests">My requests</a>
      </div>
    </header>

    <section class="bf-card" aria-labelledby="pick-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="pick-title">Read details from a verified file</h2>
      </div>
      <div class="bf-form">
        <mat-form-field appearance="outline" class="bf-form__wide" subscriptSizing="dynamic">
          <mat-label>Document id</mat-label>
          <input matInput [(ngModel)]="documentId" data-testid="document-id" />
          <mat-hint>Extraction runs after the upload has been verified.</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Kind</mat-label>
          <mat-select [(ngModel)]="kind">
            <mat-option value="receipt">Receipt</mat-option>
            <mat-option value="quote">Quote</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      <div class="bf-form__actions">
        <button
          mat-flat-button
          type="button"
          [disabled]="reading() || !documentId().trim()"
          (click)="extract()"
          data-testid="read-document"
        >
          Read details
        </button>
        <button mat-button type="button" (click)="skip()" data-testid="skip-extraction">
          Enter details myself
        </button>
      </div>
    </section>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Receipt and quote extraction"
        [detail]="detail"
        stillWorks="Uploading a receipt and typing its details works as before."
      />
    }
    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="extraction-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }
    @if (reading()) {
      <section class="bf-card">
        <div class="bf-card__body"><bf-ai-preparing label="Reading your file…" /></div>
      </section>
    }
    @if (skipped()) {
      <sat-banner variant="info" data-testid="extraction-skipped">
        <sat-banner-message>
          Extraction skipped. Enter the details yourself on the upload form.
        </sat-banner-message>
      </sat-banner>
    }

    @if (result(); as r) {
      @if (!r.readable) {
        <sat-banner variant="info" data-testid="unreadable">
          <sat-banner-message>
            {{ r.message ?? 'We could not read this file. Enter the details yourself.' }}
          </sat-banner-message>
        </sat-banner>
      } @else {
        <section class="bf-card" aria-labelledby="fields-title" data-testid="extracted-fields">
          <div class="bf-card__header">
            <div class="bf-title-row">
              <h2 class="bf-card__title" id="fields-title">
                We read these details from your {{ r.kind }}
              </h2>
              <bf-ai-label text="AI-filled" />
            </div>
            @if (r.status !== 'open') {
              <sat-status-tag [status]="r.status === 'accepted' ? 'success' : 'neutral'">
                {{ r.status === 'accepted' ? 'Confirmed' : 'Dismissed' }}
              </sat-status-tag>
            }
          </div>
          <div class="bf-card__body bf-extract">
            @if (needsCheck().length) {
              <sat-banner variant="warning" data-testid="needs-check">
                <sat-banner-message>
                  {{ needsCheck().length }}
                  {{ needsCheck().length === 1 ? 'field needs' : 'fields need' }} checking: we could
                  not read {{ needsCheckNames() }} clearly, so nothing was guessed. Fill them in
                  yourself.
                </sat-banner-message>
              </sat-banner>
            }

            <div class="bf-form">
              @for (f of r.fields; track f.field) {
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ f.label }}</mat-label>
                  <input
                    matInput
                    [value]="valueFor(f)"
                    (input)="setField(f.field, $event)"
                    [attr.data-testid]="'field-' + f.field"
                  />
                  <mat-hint>{{ hint(f) }}</mat-hint>
                </mat-form-field>
              }
            </div>

            @if (r.droppedFields.length) {
              <p class="bf-cell__secondary" data-testid="dropped-fields">
                Read and discarded, never stored: {{ r.droppedFields.join(', ') }}.
              </p>
            }

            <bf-ai-sources [sources]="r.sources" />
            <bf-ai-provenance [provenance]="r.provenance" />

            @if (r.status === 'open') {
              <mat-checkbox [(ngModel)]="checked" data-testid="confirm-checked">
                I have checked these details
              </mat-checkbox>
              <div class="bf-form__actions">
                <button
                  satImportantButton
                  type="button"
                  [disabled]="busy() || !checked() || incomplete()"
                  (click)="confirm(r)"
                  data-testid="confirm-fields"
                >
                  Confirm these details
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="dismiss(r)"
                  data-testid="dismiss-extraction"
                >
                  Discard and type them myself
                </button>
                <bf-ai-feedback (rating)="rate(r, $event)" />
              </div>
              @if (incomplete()) {
                <p class="bf-cell__secondary" data-testid="incomplete-note">
                  Fill in every field before confirming. Only values you confirm are recorded.
                </p>
              }
            } @else if (r.confirmedFields) {
              <div>
                <h3 class="bf-section__title">The values you confirmed</h3>
                <dl class="bf-facts" data-testid="confirmed-fields">
                  @for (entry of confirmedEntries(r); track entry[0]) {
                    <div>
                      <dt>{{ entry[0] }}</dt>
                      <dd>{{ entry[1] }}</dd>
                    </div>
                  }
                </dl>
              </div>
            }
            @if (actionError(); as message) {
              <sat-banner variant="important" data-testid="confirm-error">
                <sat-banner-message>{{ message }}</sat-banner-message>
              </sat-banner>
            }
          </div>
        </section>
      }
    } @else if (!reading() && !disabled() && !failure() && !skipped()) {
      <sat-empty-state data-testid="extraction-empty">
        <h2 satEmptyStateHeadline>No file read yet</h2>
        <p satEmptyStateDescription>
          Give the id of a verified receipt or quote. Card numbers, signatures and contact details
          are discarded by the extractor and never stored.
        </p>
      </sat-empty-state>
    }
  `,
  styles: `
    .bf-extract {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtractionPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  private readonly query = this.route.snapshot.queryParamMap;

  protected readonly documentId = signal(this.query.get('documentId') ?? '');
  protected readonly kind = signal<'receipt' | 'quote'>(
    this.query.get('kind') === 'quote' ? 'quote' : 'receipt',
  );
  protected readonly reading = signal(false);
  protected readonly busy = signal(false);
  protected readonly skipped = signal(false);
  protected readonly checked = signal(false);
  protected readonly result = signal<ExtractionResult | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly disabled = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  /** What the person has in the form: the extracted value until they change it. */
  protected readonly values = signal<Record<string, string>>({});

  protected readonly needsCheck = computed(
    () => this.result()?.fields.filter((f) => f.needsCheck) ?? [],
  );
  protected readonly needsCheckNames = computed(() =>
    this.needsCheck()
      .map((f) => f.label.toLowerCase())
      .join(', '),
  );
  protected readonly incomplete = computed(() =>
    (this.result()?.fields ?? []).some((f) => !this.valueFor(f).trim()),
  );

  protected valueFor(field: ExtractedField): string {
    return this.values()[field.field] ?? field.value ?? '';
  }

  protected hint(field: ExtractedField): string {
    if (field.needsCheck) return 'Please check: we could not read this clearly';
    const edited = this.values()[field.field] !== undefined;
    return edited
      ? 'Edited by you'
      : `AI-filled${field.confidence ? `, ${field.confidence} confidence` : ''}`;
  }

  protected confirmedEntries(r: ExtractionResult): [string, string][] {
    return Object.entries(r.confirmedFields ?? {});
  }

  protected setField(field: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.values.update((v) => ({ ...v, [field]: value }));
  }

  protected skip(): void {
    this.skipped.set(true);
    this.result.set(null);
  }

  protected async extract(): Promise<void> {
    const documentId = this.documentId().trim();
    if (!documentId) return;
    this.reading.set(true);
    this.failure.set(null);
    this.disabled.set(null);
    this.skipped.set(false);
    this.result.set(null);
    this.values.set({});
    this.checked.set(false);
    try {
      this.result.set(
        await data(
          this.api.extractDocument({
            body: { documentId, kind: this.kind(), channel: 'web' },
          }),
        ),
      );
    } catch (error) {
      if (isFeatureDisabled(error)) this.disabled.set(errorMessage(error));
      else this.failure.set(errorMessage(error));
    } finally {
      this.reading.set(false);
    }
  }

  /** Records the values the person checked. Extraction never posts money on its own. */
  protected async confirm(r: ExtractionResult): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const confirmedFields = Object.fromEntries(
        r.fields.map((f) => [f.field, this.valueFor(f)]).filter(([, v]) => v),
      );
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId: r.id },
          body: { decision: 'accepted', confirmedFields },
        }),
      );
      this.result.update((current) =>
        current ? { ...current, status: 'accepted', confirmedFields } : current,
      );
      this.snack.open('Details confirmed and recorded against this file.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async dismiss(r: ExtractionResult): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId: r.id },
          body: { decision: 'dismissed', reasonCode: 'TYPED_MYSELF' },
        }),
      );
      this.result.update((current) => (current ? { ...current, status: 'dismissed' } : current));
      this.skipped.set(true);
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async rate(r: ExtractionResult, rating: 'helpful' | 'not_helpful'): Promise<void> {
    try {
      await data(this.api.rateAiSuggestion({ params: { suggestionId: r.id }, body: { rating } }));
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }
}
