import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  resource,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import type { NotificationItem } from '@bf/contracts';
import {
  AccessDenied,
  AnalyticsTracker,
  ApiService,
  AuthService,
  SessionStore,
} from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_APP_HEADER_IMPORTS } from '@hylandsoftware/satori-ui/app-header';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SatBreadcrumbs } from '@hylandsoftware/satori-ui/breadcrumbs';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import {
  SAT_PLATFORM_NAV_IMPORTS,
  SatPlatformNavState,
} from '@hylandsoftware/satori-ui/platform-nav';
import { filter } from 'rxjs';
import { ROLE_LABELS, visibleNav } from './nav';

type Crumb = { label: string; routerLink?: string };

const TONE_ICON: Record<NotificationItem['tone'], string> = {
  neutral: 'info',
  info: 'info',
  warning: 'critical',
  important: 'error',
  success: 'circle_check',
};

/** The signed-in frame: role-aware navigation, header (company, fiscal year, notifications), states. */
@Component({
  selector: 'bf-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatBadgeModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatMenuModule,
    SAT_PLATFORM_NAV_IMPORTS,
    SAT_APP_HEADER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatAvatar,
    SatBreadcrumbs,
    SatCategoryTag,
    SatGhost,
    DateTimePipe,
    Money,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closeNavOnEscape()',
    '(document:keydown.escape)': 'closeNavFromBody($event)',
  },
})
export class Shell {
  protected readonly session = inject(SessionStore);
  protected readonly auth = inject(AuthService);
  protected readonly navState = inject(SatPlatformNavState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly analytics = inject(AnalyticsTracker);
  private readonly denied = inject(AccessDenied);
  private readonly document = inject(DOCUMENT);
  private readonly api = inject(ApiService).client;
  private readonly menuTriggers = viewChildren(MatMenuTrigger);

  protected readonly me = this.session.me;
  protected readonly nav = computed(() => visibleNav(this.session.permissions()));
  protected readonly roleLabel = computed(() =>
    (this.me()?.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(', '),
  );
  protected readonly userSubtitle = computed(() =>
    [this.roleLabel(), this.me()?.locationName].filter(Boolean).join(' · '),
  );
  protected readonly fiscalYear = computed(() => {
    const me = this.me();
    if (!me) return null;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: me.tenantTimezone }).format(
      new Date(),
    );
    return me.fiscalYears.find((y) => y.startDate <= today && today <= y.endDate)?.label ?? null;
  });
  protected readonly officeLine = computed(() =>
    [this.me()?.tenantName, this.me()?.locationName].filter(Boolean).join(' · '),
  );
  protected readonly crumbs = signal<Crumb[]>([]);
  protected readonly pageTitle = computed(() => this.crumbs().at(-1)?.label ?? 'Home');
  /** On phones the breadcrumbs collapse to a back link to the parent page. */
  protected readonly backTo = computed(() => {
    const c = this.crumbs();
    return c.length > 1 ? (c[c.length - 2] ?? null) : null;
  });

  /** The bell's feed: unread count, the latest items and open tasks, read again when it opens. */
  protected readonly notificationsFeed = resource({
    params: () => (this.session.state() === 'ready' ? { tab: 'all' as const } : undefined),
    loader: async ({ params }) => {
      const r = await this.api.listNotifications({ query: { ...params, periodDays: 90 } });
      if (!r.ok) throw new Error(r.problem?.detail ?? 'Notifications could not load.');
      return r.data;
    },
  });
  protected readonly feed = computed(() =>
    this.notificationsFeed.hasValue() ? this.notificationsFeed.value() : undefined,
  );
  protected readonly unread = computed(() => this.feed()?.counts.unread ?? 0);
  protected readonly recent = computed(() => (this.feed()?.items ?? []).slice(0, 5));
  protected readonly openTasks = computed(() => (this.feed()?.tasks ?? []).slice(0, 5));
  protected readonly notificationsTab = signal<'all' | 'tasks'>('all');
  protected readonly marking = signal(false);
  protected readonly markProblem = signal<string | null>(null);

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => {
        const leaf = this.leaf();
        this.crumbs.set(this.crumbsFor(leaf));
        this.analytics.track('page.viewed', { route: this.template(leaf) });
        this.closeNav();
      });
    effect(() => {
      if (this.auth.justSignedIn() && this.session.state() === 'ready') {
        this.auth.justSignedIn.set(false);
        this.analytics.track('session.started');
      }
    });
  }

  /**
   * Satori's expanded navigation is a modal overlay at every width (it has no docked mode), so it
   * closes once a page is picked, on Escape and on the scrim; the collapsed rail never covers content.
   */
  protected closeNav(): void {
    if (!this.navState.collapsed()) this.navState.toggleCollapsed();
  }

  /** An open menu takes Escape first; a menu opened by mouse leaves focus on its trigger in the shell. */
  protected closeNavOnEscape(): void {
    if (!this.menuTriggers().some((t) => t.menuOpen)) this.closeNav();
  }

  /** Menus and dialogs render outside the shell and take their own Escape; this covers an unfocused page. */
  protected closeNavFromBody(event: Event): void {
    if (event.target === this.document.body) this.closeNavOnEscape();
  }

  protected toneIcon(tone: NotificationItem['tone']): string {
    return TONE_ICON[tone];
  }

  /** API links carry their query in the string; the router takes the path and the query apart. */
  protected linkPath(link: string): string {
    return link.split('?')[0].split('#')[0];
  }

  protected linkQuery(link: string): Record<string, string> | null {
    const q = link.split('?')[1]?.split('#')[0];
    return q ? Object.fromEntries(new URLSearchParams(q).entries()) : null;
  }

  protected async markAllRead(): Promise<void> {
    this.marking.set(true);
    this.markProblem.set(null);
    try {
      const r = await this.api.markNotifications({ body: { markAll: true, read: true } });
      if (r.ok) this.notificationsFeed.reload();
      else
        this.markProblem.set(r.problem?.detail ?? 'They could not be marked as read. Try again.');
    } finally {
      this.marking.set(false);
    }
  }

  protected signOut(): void {
    void this.analytics.flush().finally(() => this.auth.signOut());
  }

  protected signInAgain(): void {
    void this.auth.signIn(this.router.url);
  }

  protected retry(): void {
    void this.session.reload();
  }

  private leaf(): ActivatedRouteSnapshot {
    let s = this.route.snapshot;
    while (s.firstChild) s = s.firstChild;
    return s;
  }

  private template(leaf: ActivatedRouteSnapshot): string {
    const parts = leaf.pathFromRoot.map((s) => s.routeConfig?.path ?? '').filter(Boolean);
    return `/${parts.join('/')}`;
  }

  private crumbsFor(leaf: ActivatedRouteSnapshot): Crumb[] {
    const home: Crumb = { label: 'Home', routerLink: '/' };
    if (leaf.routeConfig?.path === 'forbidden') {
      return [home, { label: this.denied.attempt()?.title ?? 'Access denied' }];
    }
    const title = leaf.data['pageTitle'] as string | undefined;
    if (!title) return [{ label: 'Home' }];
    // Sections (Budgets, Finance, ...) have no page of their own, so they are not crumbs. A route
    // under a list page names it as `crumbParent` ({ label, routerLink }), and may resolve its own
    // label (an event or budget name) as `crumbLabel`: Home > Events > Diwali celebration 2026.
    const parent = leaf.data['crumbParent'] as Crumb | undefined;
    const label = (leaf.data['crumbLabel'] as string | undefined) || title;
    return parent ? [home, parent, { label }] : [home, { label }];
  }
}
