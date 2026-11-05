import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { errorMessage, errorStatus } from './api';

@Component({
  selector: 'bf-load-state',
  imports: [MatButtonModule, SatGhost, SAT_EMPTY_STATE_IMPORTS],
  template: `
    @if (loading()) {
      <div class="bf-load" aria-busy="true" [attr.aria-label]="'Loading ' + what()">
        @for (row of rows(); track $index) {
          <sat-ghost variant="box" [height]="20" fitContainer />
        }
      </div>
    } @else if (status() === 403) {
      <sat-403-error-state>
        <h2 satErrorStateHeadline>You cannot see {{ what() }}</h2>
        <p satErrorStateDescription>{{ message() }}</p>
      </sat-403-error-state>
    } @else if (status() === 404) {
      <sat-404-error-state>
        <h2 satErrorStateHeadline>{{ what() }} not found</h2>
        <p satErrorStateDescription>It does not exist or is outside what you can see.</p>
      </sat-404-error-state>
    } @else if (error()) {
      <sat-500-error-state>
        <h2 satErrorStateHeadline>{{ what() }} could not load</h2>
        <p satErrorStateDescription>{{ message() }}</p>
        <button mat-stroked-button type="button" (click)="retry.emit()">Try again</button>
      </sat-500-error-state>
    }
  `,
  styles: `
    .bf-load {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadState {
  readonly loading = input(false);
  readonly error = input<unknown>(undefined);
  readonly what = input('this page');
  readonly lines = input(4);
  readonly retry = output<void>();
  protected readonly status = computed(() => errorStatus(this.error()));
  protected readonly message = computed(() => errorMessage(this.error()));
  protected readonly rows = computed(() => Array.from({ length: this.lines() }));
}
