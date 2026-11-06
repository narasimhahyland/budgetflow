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
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { DuplicateGroupView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { byNewest, byRank, ordered } from './order';

type Resolution = 'kept_one' | 'kept_both';

/**
 * Screen 099a: spend that arrived from more than one source, held before it is matched so nobody
 * counts it twice. Finance decides which line is the record; the other is excluded, never deleted.
 */
@Component({
  selector: 'bf-duplicates-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './duplicates.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuplicatesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canResolve = computed(() => this.session.can('actuals.manage'));

  protected readonly view = signal<'open' | 'resolved'>('open');
  protected readonly groups = resource({
    params: () => ({ status: this.view() }),
    loader: ({ params }) => data(this.api.listCrossSourceDuplicates({ query: params })),
  });

  protected readonly openCount = computed(() => valueOf(this.groups)?.open ?? 0);

  /** High confidence first, then newest; `flagId` breaks any remaining tie. */
  protected readonly items = computed(() =>
    [...(valueOf(this.groups)?.items ?? [])]
      .map((g) => ({ ...g, id: g.flagId }))
      .sort(
        (a, b) =>
          (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1) ||
          b.detectedAt.localeCompare(a.detectedAt) ||
          a.flagId.localeCompare(b.flagId),
      ),
  );

  protected readonly selected = signal<string | null>(null);
  protected readonly group = computed(
    () => this.items().find((g) => g.flagId === this.selected()) ?? null,
  );

  protected readonly resolution = signal<Resolution>('kept_one');
  protected readonly keepActualId = signal<string | null>(null);
  protected readonly reasonCode = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  /** Lines in a fixed order so the two columns never swap between loads. */
  protected lines(g: DuplicateGroupView) {
    return ordered(
      g.lines.map((l) => ({ ...l, id: l.actualId })),
      byRank<{ source: string }>((l) => (l.source === 'erp' || l.source === 'ap' ? 0 : 1)),
      byNewest<{ accountingDate: string }>((l) => l.accountingDate),
    );
  }

  /** A line already matched cannot simply be dropped: excluding it posts a reversal. */
  protected alreadyMatched(g: DuplicateGroupView): boolean {
    return g.lines.some((l) => l.matchStatus === 'matched');
  }

  protected select(g: DuplicateGroupView): void {
    const next = this.selected() === g.flagId ? null : g.flagId;
    this.selected.set(next);
    this.resolution.set('kept_one');
    this.keepActualId.set(next ? (this.lines(g)[0]?.actualId ?? null) : null);
    this.reasonCode.set('');
    this.reason.set('');
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async resolve(): Promise<void> {
    const g = this.group();
    if (!g) return;
    const keepActualId = this.keepActualId();
    await this.act(async () => {
      await data(
        this.api.resolveCrossSourceDuplicate({
          params: { flagId: g.flagId },
          body: {
            resolution: this.resolution(),
            ...(this.resolution() === 'kept_one' && keepActualId ? { keepActualId } : {}),
            reasonCode: this.reasonCode().trim(),
            reason: this.reason().trim(),
          },
        }),
      );
      this.notice.set(
        this.resolution() === 'kept_one'
          ? 'One line is now the record. The other is excluded from consumption and linked to it; nothing was deleted.'
          : 'Marked as two different payments. Both consume budget, and your reason feeds the detection rules.',
      );
      this.selected.set(null);
      this.groups.reload();
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
