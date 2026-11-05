import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
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
import { AccessDenied, AnalyticsTracker, AuthService, SessionStore } from '@bf/web/data-access';
import { SAT_APP_HEADER_IMPORTS } from '@hylandsoftware/satori-ui/app-header';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SatBreadcrumbs } from '@hylandsoftware/satori-ui/breadcrumbs';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import {
  SAT_PLATFORM_NAV_IMPORTS,
  SatPlatformNavState,
} from '@hylandsoftware/satori-ui/platform-nav';
import { filter } from 'rxjs';
import { ROLE_LABELS, visibleNav } from './nav';

type Crumb = { label: string; routerLink?: string };

/** The signed-in frame: role-aware navigation, header (company, fiscal year, reporting currency), states. */
@Component({
  selector: 'bf-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    SAT_PLATFORM_NAV_IMPORTS,
    SAT_APP_HEADER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatAvatar,
    SatBreadcrumbs,
    SatGhost,
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
  protected readonly crumbs = signal<Crumb[]>([]);
  protected readonly pageTitle = computed(() => this.crumbs().at(-1)?.label ?? 'Home');

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
    // Sections (Budgets, Finance, ...) have no page of their own, so they are not crumbs.
    return [home, { label: title }];
  }
}
