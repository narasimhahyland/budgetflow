import { formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, type DocumentSummary } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_UPLOAD_IMPORTS } from '@hylandsoftware/satori-ui/upload';
import { data, errorMessage, injectApi } from './api';

/** Supporting documents of a record: list, signed download, and upload (declare, PUT to the signed URL, verify). */
@Component({
  selector: 'bf-documents-panel',
  imports: [MatButtonModule, MatIconModule, SAT_BANNER_IMPORTS, SAT_UPLOAD_IMPORTS],
  template: `
    @if (failure()) {
      <sat-banner variant="important" class="bf-banner"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <ul class="bf-docs" aria-label="Documents">
      @for (d of documents(); track d.id) {
        <li class="bf-docs__item">
          <mat-icon svgIcon="document" aria-hidden="true" />
          <span class="bf-docs__name"
            >{{ d.fileName
            }}<span class="bf-docs__meta"
              >{{ size(d.sizeBytes) }} · {{ d.uploadedByName ?? ''
              }}{{ d.status === 'pending' ? ' · verifying' : '' }}</span
            ></span
          >
          @if (d.status === 'available') {
            <button mat-button type="button" (click)="download(d)">
              <mat-icon svgIcon="download" />Download
            </button>
          }
        </li>
      } @empty {
        <li class="bf-docs__empty">No documents yet.</li>
      }
    </ul>
    @if (canUpload()) {
      <div class="bf-docs__upload">
        <button
          mat-stroked-button
          type="button"
          satUpload
          [input]="docInput"
          [disabled]="busy()"
          (filesLoaded)="pick($event[0])"
        >
          <mat-icon svgIcon="upload" />{{ busy() ? 'Uploading…' : 'Upload a document' }}
        </button>
        <input
          #docInput
          class="bf-docs__native"
          type="file"
          [accept]="accept"
          [disabled]="busy()"
          aria-label="Choose a document to upload"
        />
        <span class="bf-docs__meta">PDF, PNG, JPEG, CSV or XLSX, up to 10 MB</span>
      </div>
    }
  `,
  styles: `
    .bf-docs {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 8px 20px;
      list-style: none;
    }
    .bf-docs__item {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .bf-docs__name {
      display: flex;
      flex: 1;
      flex-direction: column;
      font: var(--mat-sys-body-medium);
    }
    .bf-docs__meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-docs__empty {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-docs__upload {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 8px 20px 16px;
    }
    .bf-docs__native {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsPanel {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  readonly ownerType = input.required<'event' | 'request' | 'contribution' | 'commitment'>();
  readonly ownerId = input.required<string>();
  readonly documents = input<DocumentSummary[]>([]);
  readonly canUpload = input(false);
  readonly changed = output<void>();
  protected readonly accept = DOCUMENT_CONTENT_TYPES.join(',');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected size(bytes: number): string {
    return bytes >= 1_048_576
      ? `${formatNumber(bytes / 1_048_576, 'en-US', '1.1-1')} MB`
      : `${formatNumber(Math.max(1, Math.round(bytes / 1024)), 'en-US')} KB`;
  }

  protected async download(d: DocumentSummary): Promise<void> {
    try {
      const r = await data(this.api.downloadDocument({ params: { documentId: d.id } }));
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      this.failure.set(errorMessage(e));
    }
  }

  protected async pick(file: File | undefined): Promise<void> {
    if (!file) return;
    this.failure.set('');
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      this.failure.set('Upload a PDF, PNG, JPEG, CSV or XLSX file.');
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      this.failure.set('Documents can be at most 10 MB.');
      return;
    }
    this.busy.set(true);
    try {
      const upload = await data(
        this.api.createDocumentUpload({
          body: {
            ownerType: this.ownerType(),
            ownerId: this.ownerId(),
            fileName: file.name,
            contentType: file.type as (typeof DOCUMENT_CONTENT_TYPES)[number],
            sizeBytes: file.size,
          },
        }),
      );
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.uploadHeaders,
        body: file,
      });
      if (!put.ok) throw new Error('upload');
      await data(this.api.completeDocumentUpload({ params: { documentId: upload.document.id } }));
      this.snack.open(`Attached ${file.name}`, undefined, { duration: 4000 });
      this.changed.emit();
    } catch (e) {
      this.failure.set(
        e instanceof Error && e.message === 'upload'
          ? 'The upload failed; try again.'
          : errorMessage(e),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
