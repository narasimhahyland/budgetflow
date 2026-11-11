import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_KINDS,
  type RequestSummary,
} from '@bf/contracts';
import { formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_UPLOAD_IMPORTS } from '@hylandsoftware/satori-ui/upload';
import { data, errorMessage, injectApi, valueOf } from './api';
import { toMinor } from './money-input';

type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const KINDS: { id: DocumentKind; label: string }[] = [
  { id: 'receipt', label: 'Receipt' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'quotation', label: 'Quotation' },
  { id: 'supporting', label: 'Supporting document' },
];

/** Screen 121: attach a receipt or document to one of my requests (declare, upload to the signed URL, verify). */
@Component({
  selector: 'bf-upload-receipt-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_UPLOAD_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Upload a receipt or document</h1>
        <p class="bf-page__subtitle">
          Files are checked before approvers and finance can open them
        </p>
      </div>
    </header>
    <bf-load-state
      [loading]="list.isLoading() && !list.hasValue()"
      [error]="list.error()"
      what="your requests"
      (retry)="list.reload()"
    />
    @if (failure()) {
      <sat-banner variant="important" data-testid="upload-failure"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (list.hasValue()) {
      <section class="bf-card" aria-labelledby="for-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="for-title">1. What is it for</h2>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Request</mat-label>
            <mat-select [(ngModel)]="requestId" name="request" (ngModelChange)="touch()">
              @for (r of requests(); track r.id) {
                <mat-option [value]="r.id">{{ r.ref }} {{ r.title }}</mat-option>
              }
            </mat-select>
            @if (requests().length === 0) {
              <mat-hint>You have no requests to attach a document to.</mat-hint>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Document kind</mat-label>
            <mat-select [(ngModel)]="kind" name="kind" (ngModelChange)="touch()">
              @for (k of kinds; track k.id) {
                <mat-option [value]="k.id">{{ k.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        @if (selected(); as r) {
          <p class="bf-card__hint bf-upload__context">
            {{ r.ref }} · {{ r.budgetName }} ·
            {{ r.approvedAmount ? 'approved' : 'requested' }}
            <bf-money
              [amountMinor]="(r.approvedAmount ?? r.amount).amountMinor"
              [currency]="r.amount.currency"
            />
          </p>
        }
      </section>
      <section class="bf-card" aria-labelledby="file-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="file-title">2. File</h2>
        </div>
        <div class="bf-section">
          @if (file(); as f) {
            <div class="bf-upload__file" data-testid="chosen-file">
              <mat-icon svgIcon="document" aria-hidden="true" />
              <span class="bf-cell__primary">{{ f.name }}</span>
              <span class="bf-cell__secondary">{{ size(f.size) }}</span>
              <button mat-button type="button" [disabled]="busy()" (click)="file.set(null)">
                Remove
              </button>
            </div>
          } @else {
            <sat-upload-area
              class="bf-upload__area"
              [input]="fileInput"
              (filesLoaded)="choose($event[0] ?? null)"
            >
              <mat-icon svgIcon="upload" aria-hidden="true" />
              <span class="bf-cell__primary"
                >Drop a file or <span class="bf-upload__link">browse</span></span
              >
              <span class="bf-cell__secondary">PDF, PNG, JPEG, CSV or XLSX, up to 10 MB</span>
            </sat-upload-area>
            <input
              #fileInput
              class="bf-upload__native"
              type="file"
              [accept]="accept"
              aria-label="Choose a file to upload"
            />
          }
          @if (stage() !== 'idle') {
            <div class="bf-upload__progress" role="status">
              <mat-progress-bar mode="indeterminate" />
              <span class="bf-cell__secondary">{{
                stage() === 'uploading' ? 'Uploading the file' : 'Checking the file'
              }}</span>
            </div>
          }
        </div>
      </section>
      @if (kind === 'receipt' || kind === 'invoice') {
        <section class="bf-card" aria-labelledby="details-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="details-title">3. Amount check (optional)</h2>
            <span class="bf-card__hint"
              >Only for this check; finance confirms the amount when it matches the receipt</span
            >
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline">
              <mat-label
                >Amount on the {{ kind }} ({{ selected()?.amount?.currency ?? 'USD' }})</mat-label
              >
              <span matTextPrefix>{{ selected()?.amount?.currency ?? 'USD' }}&nbsp;</span>
              <input
                matInput
                inputmode="decimal"
                [(ngModel)]="receiptAmount"
                name="receiptAmount"
                (ngModelChange)="touch()"
              />
            </mat-form-field>
          </div>
          @if (comparison(); as c) {
            <sat-banner [variant]="c.over ? 'warning' : 'info'" data-testid="amount-check"
              ><sat-banner-message>{{ c.text }}</sat-banner-message></sat-banner
            >
          }
        </section>
      }
      <div class="bf-form__actions">
        @if (!busy() && (!requestId || !file())) {
          <p class="bf-upload__why" id="upload-why">
            {{
              !requestId ? 'Choose the request this document belongs to.' : 'Choose a file first.'
            }}
          </p>
        }
        <a mat-button [routerLink]="backLink()">Cancel</a>
        <button
          mat-flat-button
          type="button"
          [disabled]="!requestId || !file() || busy()"
          [attr.aria-describedby]="!requestId || !file() ? 'upload-why' : null"
          (click)="upload()"
        >
          Upload {{ kindLabel() }}
        </button>
      </div>
    }
  `,
  styles: `
    .bf-upload__context {
      display: block;
      padding: 0 20px 16px;
    }
    .bf-upload__area {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 32px 16px;
      border: 2px dashed var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      cursor: pointer;
      text-align: center;
    }
    .bf-upload__link {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .bf-upload__native {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
    }
    .bf-upload__why {
      flex: 1 1 240px;
      margin: 0;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-upload__file {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-upload__progress {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 12px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadReceiptPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly preset = inject(ActivatedRoute).snapshot.queryParamMap.get('request');
  protected readonly kinds = KINDS;
  protected readonly accept = DOCUMENT_CONTENT_TYPES.join(',');
  protected requestId = this.preset ?? '';
  protected kind: DocumentKind = 'receipt';
  protected receiptAmount = '';
  protected readonly file = signal<File | null>(null);
  protected readonly stage = signal<'idle' | 'uploading' | 'verifying'>('idle');
  protected readonly busy = computed(() => this.stage() !== 'idle');
  protected readonly failure = signal('');
  private readonly version = signal(0);

  protected readonly list = resource({
    loader: () => data(this.api.listRequests({ query: { scope: 'mine', tab: 'all', limit: 200 } })),
  });
  protected readonly requests = computed<RequestSummary[]>(() =>
    (valueOf(this.list)?.items ?? []).filter((r) => r.status !== 'draft'),
  );
  protected readonly selected = computed(() => {
    this.version();
    return this.requests().find((r) => r.id === this.requestId) ?? null;
  });
  protected readonly kindLabel = computed(() => {
    this.version();
    return (KINDS.find((k) => k.id === this.kind)?.label ?? 'document').toLowerCase();
  });
  protected readonly comparison = computed(() => {
    this.version();
    const r = this.selected();
    if (!r) return null;
    const base = r.approvedAmount ?? r.amount;
    const amount = toMinor(this.receiptAmount, base.currency);
    if (amount === null || amount <= 0) return null;
    const diff = amount - base.amountMinor;
    const money = formatMoney(Math.abs(diff), base.currency);
    if (diff > 0)
      return {
        over: true,
        text: `The ${this.kind} is ${money} more than approved. Your approver will be asked to accept the difference.`,
      };
    if (diff < 0)
      return {
        over: false,
        text: `${money} less than approved. The rest returns to the budget when finance matches the ${this.kind}.`,
      };
    return { over: false, text: 'Matches the approved amount.' };
  });
  protected readonly backLink = computed(() => {
    this.version();
    return this.requestId ? ['/requests', this.requestId] : ['/requests'];
  });

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected size(bytes: number): string {
    return bytes >= 1_048_576
      ? `${formatNumber(bytes / 1_048_576, 'en-US', '1.1-1')} MB`
      : `${formatNumber(Math.max(1, Math.round(bytes / 1024)), 'en-US')} KB`;
  }

  protected choose(f: File | null): void {
    this.failure.set('');
    if (!f) return;
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(f.type)) {
      this.failure.set('This file type is not allowed. Upload a PDF, PNG, JPEG, CSV or XLSX file.');
      return;
    }
    if (f.size > DOCUMENT_MAX_BYTES) {
      this.failure.set('File is larger than 10 MB.');
      return;
    }
    this.file.set(f);
  }

  protected async upload(): Promise<void> {
    const f = this.file();
    const r = this.selected();
    if (!f || !r) return;
    this.failure.set('');
    this.stage.set('uploading');
    try {
      const upload = await data(
        this.api.createDocumentUpload({
          body: {
            ownerType: 'request',
            ownerId: r.id,
            kind: this.kind,
            fileName: f.name,
            contentType: f.type as (typeof DOCUMENT_CONTENT_TYPES)[number],
            sizeBytes: f.size,
          },
        }),
      );
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.uploadHeaders,
        body: f,
      });
      if (!put.ok) throw new Error('upload');
      this.stage.set('verifying');
      await data(this.api.completeDocumentUpload({ params: { documentId: upload.document.id } }));
      this.snack.open(
        `${KINDS.find((k) => k.id === this.kind)?.label} added to ${r.ref}`,
        undefined,
        {
          duration: 4000,
        },
      );
      await this.router.navigate(['/requests', r.id], { queryParams: { tab: 'documents' } });
    } catch (e) {
      this.failure.set(
        e instanceof Error && e.message === 'upload'
          ? 'The upload failed; try again.'
          : errorMessage(e),
      );
    } finally {
      this.stage.set('idle');
    }
  }
}
