import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SAT_UPLOAD_IMPORTS } from '@hylandsoftware/satori-ui/upload';

/** CSV text from a dropped or chosen file, or pasted. */
@Component({
  selector: 'bf-file-input',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, SAT_UPLOAD_IMPORTS],
  template: `
    <sat-upload-area class="bf-file__drop" [input]="file" (filesLoaded)="load($event)">
      <p class="bf-file__hint">
        Drop a CSV file here or <span class="bf-file__link">choose a file</span>
        @if (fileName()) {
          <span class="bf-file__name" data-testid="file-name">Loaded {{ fileName() }}</span>
        }
      </p>
    </sat-upload-area>
    <input
      #file
      class="bf-file__native"
      type="file"
      accept=".csv,text/csv"
      [attr.aria-label]="label()"
    />
    <mat-form-field class="bf-file__text" appearance="outline">
      <mat-label>Or paste the CSV</mat-label>
      <textarea
        matInput
        rows="5"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
        data-testid="csv-text"
      ></textarea>
      <mat-hint>{{ hint() }}</mat-hint>
    </mat-form-field>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-file__drop {
      display: block;
      padding: 24px;
      border: 1px dashed var(--mat-sys-outline);
      border-radius: var(--mat-sys-corner-medium);
      text-align: center;
      cursor: pointer;
    }
    .bf-file__hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-file__link {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .bf-file__name {
      display: block;
      margin-top: 4px;
      color: var(--mat-sys-on-surface);
    }
    .bf-file__native {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileInput {
  readonly value = model('');
  readonly fileName = model<string | null>(null);
  readonly label = input('CSV file');
  readonly hint = input('');

  protected async load(files: File[]): Promise<void> {
    const f = files[0];
    if (!f) return;
    this.fileName.set(f.name);
    this.value.set(await f.text());
  }
}
