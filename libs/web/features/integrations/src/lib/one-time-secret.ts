import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';

/**
 * The only place a secret BudgetFlow issued is ever on screen (098 SCIM tokens, 101 API keys and
 * webhook signing secrets). The server stores a hash and has no way to show it again, so the panel
 * says that plainly and will not close until the person confirms they stored it.
 */
@Component({
  selector: 'bf-one-time-secret',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, SAT_BANNER_IMPORTS],
  template: `
    <sat-banner variant="warning" [attr.data-testid]="testId()">
      <sat-banner-message>
        <strong>Copy this {{ what() }} now. You will not see it again.</strong>
        BudgetFlow stores only a hash of it, so it cannot be shown or recovered later. If you lose
        it, issue a new one.
      </sat-banner-message>
    </sat-banner>
    <div class="bf-card__body bf-secret">
      <code class="bf-secret__value" [attr.aria-label]="what() + ', shown once'">{{
        secret()
      }}</code>
      <button
        mat-stroked-button
        type="button"
        (click)="copy()"
        [attr.data-testid]="testId() + '-copy'"
      >
        {{ copied() ? 'Copied' : 'Copy' }}
      </button>
      <span class="bf-sr" role="status">{{ copied() ? 'Copied to the clipboard' : '' }}</span>
    </div>
    <div class="bf-card__body">
      <mat-checkbox
        [ngModel]="stored()"
        (ngModelChange)="stored.set($event)"
        [attr.data-testid]="testId() + '-stored'"
        >I have stored this {{ what() }}</mat-checkbox
      >
    </div>
    <div class="bf-form__actions">
      <button
        mat-flat-button
        type="button"
        [disabled]="!stored()"
        (click)="done.emit()"
        [attr.data-testid]="testId() + '-done'"
      >
        Done
      </button>
    </div>
  `,
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OneTimeSecret {
  readonly secret = input.required<string>();
  readonly what = input('key');
  readonly testId = input('one-time-secret');
  readonly done = output<void>();
  protected readonly stored = signal(false);
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.secret());
      this.copied.set(true);
    } catch {
      // Clipboard access can be refused; the value stays selectable on screen.
      this.copied.set(false);
    }
  }
}
