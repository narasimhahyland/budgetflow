import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, type DocumentSummary } from '@bf/contracts';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_UPLOAD_FIELD_IMPORTS } from '@hylandsoftware/satori-ui/upload-field';
import { data, errorMessage, injectApi } from './api';

/** Supporting documents of a record: list, signed download, and upload (declare, PUT to the signed URL, verify). */
@Component({
  selector: 'bf-documents-panel',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_UPLOAD_FIELD_IMPORTS,
  ],
  template: `
    @if (failure()) {
      <sat-banner variant="important" class="bf-banner"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (documents().length === 0) {
      <sat-empty-state>
        <h3 satEmptyStateHeadline>No documents yet</h3>
        <p satEmptyStateDescription>
          Attach quotes, receipts and approval evidence so approvers and finance see them here.
        </p>
      </sat-empty-state>
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
      }
    </ul>
    @if (canUpload()) {
      <sat-upload-field
        class="bf-docs__field"
        [uploadedFiles]="null"
        (filesLoaded)="upload($event)"
      >
        <mat-label>{{ busy() ? 'Uploading…' : 'Upload a document' }}</mat-label>
        <mat-icon svgIcon="upload" />
        <input type="file" satUploadFieldInput [accept]="accept" [disabled]="busy()" />
        <mat-hint
          >PDF, PNG, JPEG, CSV or XLSX, up to 10 MB. Download links expire after 15
          minutes.</mat-hint
        >
      </sat-upload-field>
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
    .bf-docs:empty {
      display: none;
    }
    .bf-docs__field {
      display: block;
      padding: 8px 20px 16px;
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
      ? `${(bytes / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected async download(d: DocumentSummary): Promise<void> {
    try {
      const r = await data(this.api.downloadDocument({ params: { documentId: d.id } }));
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      this.failure.set(errorMessage(e));
    }
  }

  protected async upload(files: File[]): Promise<void> {
    const file = files[0];
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
