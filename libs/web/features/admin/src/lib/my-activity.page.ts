import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { MyActivityType } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const TYPE_LABEL: Record<string, string> = {
  request: 'Requests',
  approval: 'Approvals',
  event: 'Events',
  receipt: 'Receipts',
  delegation: 'Delegations',
  export: 'Exports',
  comment: 'Comments',
  budget: 'Budgets',
  other: 'Other',
} satisfies Record<MyActivityType, string>;

const TYPES = Object.keys(TYPE_LABEL) as MyActivityType[];

/**
 * Screen 122: a person's own activity. The endpoint takes no person and never shows anybody else,
 * so this page is strictly self-service.
 */
@Component({
  selector: 'bf-my-activity-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './my-activity.page.html',
  styleUrls: ['./page.scss', './my-activity.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyActivityPage {
  protected readonly valueOf = valueOf;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly types = TYPES;
  protected readonly columns = ['when', 'what', 'kind'];

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly timezone = this.session.timezone;
  protected readonly displayName = computed(() => this.session.me()?.displayName ?? '');

  protected readonly chosenTypes = signal<MyActivityType[]>([]);
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly activity = resource({
    params: () => ({
      from: this.from() || undefined,
      to: this.to() || undefined,
      types: this.chosenTypes().length > 0 ? this.chosenTypes().join(',') : undefined,
    }),
    loader: ({ params }) => data(this.api.myActivity({ query: params })),
  });

  protected readonly filtered = computed(
    () => this.chosenTypes().length > 0 || this.from() !== '' || this.to() !== '',
  );

  protected clear(): void {
    this.chosenTypes.set([]);
    this.from.set('');
    this.to.set('');
  }
}
