import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { WIDGET_KINDS, type WidgetKind, type WidgetView } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';
import type { Tone } from '../labels';
import { LoadState } from '../load-state';
import { byRank, byText, ordered } from '../order';
import { EcosystemNav } from './ecosystem-nav';
import { WIDGET_KIND_LABELS, WIDGET_STATUS_LABELS, WIDGET_STATUS_TONES } from './labels';

/** The exact form `frame-ancestors` can enforce; a wildcard would mean any page on any host. */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{2,5})?$/i;

/**
 * Screen 102d. Two rules this page exists to make unmissable.
 *
 * - **The viewer is the viewer.** A widget never carries an identity. Whoever loads the frame sees
 *   their own data through their own session, so a widget cannot leak one person's budget to
 *   another, and the page says so instead of leaving it to be inferred.
 * - **The allowed-site list is the boundary.** It is the whole of what decides where a widget can
 *   render. An empty list means nowhere, a site off the list is refused, and the refusals are shown
 *   with their address so a missing entry is found rather than guessed at.
 */
@Component({
  selector: 'bf-widgets-page',
  imports: [
    DecimalPipe,
    EcosystemNav,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './widgets.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetsPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly kinds = WIDGET_KINDS;
  protected readonly columns = ['name', 'origins', 'amounts', 'views', 'status', 'actions'];

  protected readonly widgets = resource({ loader: () => data(this.api.listWidgets({})) });
  protected readonly canManage = computed(() => valueOf(this.widgets)?.canManage ?? false);

  /** Widgets being refused somewhere first: a blocked embed is the thing someone has to look at. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.widgets)?.items ?? [],
      byRank<WidgetView>((w) => (w.blockedOriginsLast30Days.length ? 0 : 1)),
      byText<WidgetView>((w) => w.name),
    ),
  );

  protected readonly totalRefused = computed(() =>
    this.items().reduce((n, w) => n + w.blockedOriginsLast30Days.length, 0),
  );

  protected readonly creating = signal(false);
  protected readonly name = signal('');
  protected readonly kind = signal<WidgetKind>('team_budget');
  protected readonly originsText = signal('');
  protected readonly showAmounts = signal(true);
  protected readonly eventCount = signal(3);

  protected readonly editing = signal<WidgetView | null>(null);
  protected readonly editOrigins = signal('');
  protected readonly removing = signal<WidgetView | null>(null);
  protected readonly copied = signal<string | null>(null);

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  /** One address a line, so a long list stays readable and a typo is on its own line. */
  private parseOrigins(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
  }

  protected readonly newOrigins = computed(() => this.parseOrigins(this.originsText()));
  protected readonly newOriginProblems = computed(() =>
    this.newOrigins().filter((o) => !ORIGIN.test(o)),
  );
  protected readonly editOriginList = computed(() => this.parseOrigins(this.editOrigins()));
  protected readonly editOriginProblems = computed(() =>
    this.editOriginList().filter((o) => !ORIGIN.test(o)),
  );

  protected kindLabel(kind: WidgetKind): string {
    return WIDGET_KIND_LABELS[kind];
  }

  protected statusLabel(status: WidgetView['status']): string {
    return WIDGET_STATUS_LABELS[status];
  }

  protected statusTone(status: WidgetView['status']): Tone {
    return WIDGET_STATUS_TONES[status];
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.editing.set(null);
    this.name.set('');
    this.kind.set('team_budget');
    this.originsText.set('');
    this.showAmounts.set(true);
    this.eventCount.set(3);
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async create(): Promise<void> {
    await this.act(async () => {
      const widget = await data(
        this.api.createWidget({
          body: {
            name: this.name().trim(),
            kind: this.kind(),
            allowedOrigins: this.newOrigins(),
            showAmounts: this.showAmounts(),
            eventCount: this.eventCount(),
          },
        }),
      );
      this.notice.set(
        `${widget.name} is ready. It renders only on ${widget.allowedOrigins.join(' and ')}; anywhere else the browser refuses the frame.`,
      );
      this.creating.set(false);
      this.widgets.reload();
    });
  }

  protected startEdit(widget: WidgetView): void {
    this.editing.set(widget);
    this.creating.set(false);
    this.editOrigins.set(widget.allowedOrigins.join('\n'));
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async saveOrigins(): Promise<void> {
    const widget = this.editing();
    if (!widget) return;
    await this.act(async () => {
      const updated = await data(
        this.api.updateWidget({
          params: { widgetId: widget.id },
          body: { allowedOrigins: this.editOriginList() },
        }),
      );
      this.notice.set(
        `${updated.name} now renders on ${updated.allowedOrigins.join(' and ')} and nowhere else.`,
      );
      this.editing.set(null);
      this.widgets.reload();
    });
  }

  protected async allowRefused(widget: WidgetView, origin: string): Promise<void> {
    await this.act(async () => {
      const updated = await data(
        this.api.updateWidget({
          params: { widgetId: widget.id },
          body: { allowedOrigins: [...widget.allowedOrigins, origin] },
        }),
      );
      this.notice.set(`${origin} may now show ${updated.name}.`);
      this.widgets.reload();
    });
  }

  protected async setStatus(widget: WidgetView, status: WidgetView['status']): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateWidget({ params: { widgetId: widget.id }, body: { status } }));
      this.notice.set(
        status === 'active'
          ? `${widget.name} is active again.`
          : `${widget.name} is paused. Embedded copies stop showing anything.`,
      );
      this.widgets.reload();
    });
  }

  protected async setAmounts(widget: WidgetView, showAmounts: boolean): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateWidget({ params: { widgetId: widget.id }, body: { showAmounts } }));
      this.notice.set(
        showAmounts
          ? `${widget.name} shows figures again.`
          : `${widget.name} now shows words without figures.`,
      );
      this.widgets.reload();
    });
  }

  protected async remove(): Promise<void> {
    const widget = this.removing();
    if (!widget) return;
    await this.act(async () => {
      await data(this.api.deleteWidget({ params: { widgetId: widget.id } }));
      this.notice.set(`${widget.name} is removed. Embedded copies stop rendering.`);
      this.removing.set(null);
      this.widgets.reload();
    });
  }

  protected async copySnippet(widget: WidgetView): Promise<void> {
    try {
      await navigator.clipboard.writeText(widget.embedSnippet);
      this.copied.set(widget.id);
    } catch {
      // Clipboard access can be refused; the snippet stays selectable on screen.
      this.copied.set(null);
    }
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
