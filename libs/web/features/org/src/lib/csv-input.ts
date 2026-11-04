import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SAT_UPLOAD_IMPORTS } from '@hylandsoftware/satori-ui/upload';

/** CSV from a dropped or chosen file, or pasted text. */
@Component({
  selector: 'bf-csv-input',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, SAT_UPLOAD_IMPORTS],
  template: `
    <sat-upload-area class="bf-csv__drop" [input]="file" (filesLoaded)="load($event)">
      <p class="bf-csv__hint">
        Drop a CSV file here or <span class="bf-csv__link">choose a file</span>
        @if (fileName()) {
          <span class="bf-csv__file">Loaded {{ fileName() }}</span>
        }
      </p>
    </sat-upload-area>
    <input #file class="bf-csv__native" type="file" accept=".csv,text/csv" aria-label="CSV file" />
    <mat-form-field class="bf-csv__text" appearance="outline">
      <mat-label>CSV content</mat-label>
      <textarea
        matInput
        rows="6"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
        [placeholder]="example()"
        data-testid="csv-text"
      ></textarea>
      <mat-hint>Columns: {{ columns() }}</mat-hint>
    </mat-form-field>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-csv__drop {
      display: block;
      padding: 20px;
      border: 1px dashed var(--mat-sys-outline);
      border-radius: var(--mat-sys-corner-medium);
      text-align: center;
      cursor: pointer;
    }
    .bf-csv__hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-csv__link {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .bf-csv__file {
      display: block;
      margin-top: 4px;
      color: var(--mat-sys-on-surface);
    }
    .bf-csv__native {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CsvInput {
  readonly value = model('');
  readonly columns = input('');
  readonly example = input('');
  protected readonly fileName = signal<string | null>(null);

  protected async load(files: File[]): Promise<void> {
    const f = files[0];
    if (!f) return;
    this.fileName.set(f.name);
    this.value.set(await f.text());
  }
}
