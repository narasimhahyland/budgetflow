import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';

interface FailedCall {
  status: number;
  message?: string;
  problem?: { detail?: string; errors?: readonly { path: string; message: string }[] } | null;
}

// Every feature's data-access wrapper throws its own error class; all carry the HTTP status and
// the problem details, so they are recognised by shape rather than by class.
const failedCall = (e: unknown): FailedCall | null =>
  typeof e === 'object' && e !== null && typeof (e as FailedCall).status === 'number'
    ? (e as FailedCall)
    : null;

/** HTTP status of a failed call (0 when the error did not come from the API). */
export const loadErrorStatus = (e: unknown): number => failedCall(e)?.status ?? 0;

/** Plain-English message for a failed call, with field errors when the API returned them. */
export function loadErrorMessage(e: unknown): string {
  const f = failedCall(e);
  if (!f) return 'Something went wrong. Try again in a moment.';
  const fields = f.problem?.errors?.map((x) => `${x.path}: ${x.message}`) ?? [];
  return [f.problem?.detail ?? f.message ?? 'The request failed.', ...fields.slice(0, 5)].join(' ');
}

/** The rough shape of what is loading, so the skeleton holds the space the content will take. */
export type LoadShape = 'lines' | 'table' | 'cards' | 'form';

/**
 * Loading skeleton, or the forbidden / not found / error state of a failed load. Satori's error
 * and empty states only render children carrying a slot attribute, so the retry button carries
 * `satErrorStateAction`.
 */
@Component({
  selector: 'bf-load-state',
  imports: [MatButtonModule, SatGhost, SAT_EMPTY_STATE_IMPORTS],
  template: `
    @if (loading()) {
      <div
        class="bf-load bf-load--{{ shape() }}"
        aria-busy="true"
        [attr.aria-label]="'Loading ' + what()"
      >
        @switch (shape()) {
          @case ('table') {
            <sat-ghost variant="box" [height]="52" fitContainer />
            @for (row of rows(); track $index) {
              <sat-ghost variant="box" [height]="40" fitContainer />
            }
          }
          @case ('cards') {
            @for (row of rows(); track $index) {
              <sat-ghost variant="box" [height]="120" fitContainer />
            }
          }
          @case ('form') {
            @for (row of rows(); track $index) {
              <sat-ghost variant="box" [height]="56" fitContainer />
            }
          }
          @default {
            @for (row of rows(); track $index) {
              <sat-ghost variant="box" [height]="20" fitContainer />
            }
          }
        }
      </div>
    } @else if (status() === 403) {
      <sat-403-error-state>
        <h2 satErrorStateHeadline>You cannot see {{ what() }}</h2>
        <p satErrorStateDescription>{{ message() }}</p>
      </sat-403-error-state>
    } @else if (status() === 404) {
      <sat-404-error-state>
        <h2 satErrorStateHeadline>We could not find {{ what() }}</h2>
        <p satErrorStateDescription>It does not exist or is outside what you can see.</p>
      </sat-404-error-state>
    } @else if (error()) {
      <sat-500-error-state>
        <h2 satErrorStateHeadline>We could not load {{ what() }}</h2>
        <p satErrorStateDescription>{{ message() }}</p>
        <button mat-stroked-button satErrorStateAction type="button" (click)="retry.emit()">
          Try again
        </button>
      </sat-500-error-state>
    }
  `,
  styles: `
    /* Idle, the host renders nothing; contents keeps it from adding a gap in a flex column. */
    :host {
      display: contents;
    }
    .bf-load {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px 20px;
    }
    .bf-load--table {
      gap: 8px;
    }
    .bf-load--cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      padding: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadState {
  readonly loading = input(false);
  readonly error = input<unknown>(undefined);
  readonly what = input('this page');
  /** Skeleton rows (table rows, cards, form fields or text lines). */
  readonly lines = input(5);
  readonly shape = input<LoadShape>('lines');
  readonly retry = output<void>();
  protected readonly status = computed(() => loadErrorStatus(this.error()));
  protected readonly message = computed(() => loadErrorMessage(this.error()));
  protected readonly rows = computed(() => Array.from({ length: this.lines() }));
}
