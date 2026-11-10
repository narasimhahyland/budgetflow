import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { OrgUnit } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from '@bf/web/ui';

type OrgKind = OrgUnit['kind'];

const KIND_LABEL: Record<OrgKind, string> = {
  company: 'Company',
  business_unit: 'Business unit',
  region: 'Region',
  location: 'Location',
  department: 'Department',
  team: 'Team',
};

/** Kinds that may sit under a parent kind (mirrors the domain rule; the API decides). */
const CHILD_KINDS: Record<OrgKind, OrgKind[]> = {
  company: ['business_unit', 'region', 'location', 'department'],
  business_unit: ['business_unit', 'region', 'location', 'department'],
  region: ['location', 'department'],
  location: ['department', 'team'],
  department: ['department', 'team'],
  team: ['team'],
};

type ChangeKind = 'rename' | 'move' | 'manager' | 'deactivate';

/** Screens 33-37: org hierarchy, chart, department, team and location details, effective-dated. */
@Component({
  selector: 'bf-org-hierarchy-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './hierarchy.page.html',
  styleUrls: ['./page.scss', './hierarchy.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgHierarchyPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly kindLabel = KIND_LABEL;

  protected readonly asOf = signal(todayIso());
  protected readonly filter = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly mode = signal<'view' | 'change' | 'add'>('view');
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly units = resource({
    params: () => ({ asOf: this.asOf() }),
    loader: ({ params }) => data(this.api.listOrgUnits({ query: params })),
  });

  protected readonly detail = resource({
    params: () => {
      const id = this.selectedId() ?? valueOf(this.units)?.items[0]?.id;
      return id ? { id, asOf: this.asOf() } : undefined;
    },
    loader: ({ params }) =>
      data(this.api.getOrgUnit({ params: { orgUnitId: params.id }, query: { asOf: params.asOf } })),
  });

  protected readonly people = resource({
    params: () => (this.mode() === 'view' ? undefined : { limit: 200 }),
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });

  protected readonly entities = resource({
    loader: () => data(this.api.listLegalEntities({})),
  });

  protected readonly entityCode = computed(
    () => new Map((valueOf(this.entities)?.items ?? []).map((e) => [e.id, `${e.code} ${e.name}`])),
  );

  protected readonly visibleUnits = computed(() => {
    const items = valueOf(this.units)?.items ?? [];
    const q = this.filter().trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q),
    );
  });

  protected readonly unitName = computed(
    () => new Map((valueOf(this.units)?.items ?? []).map((u) => [u.id, u.name])),
  );

  protected readonly scopeText = computed(() => {
    switch (valueOf(this.units)?.scope) {
      case 'tenant':
        return 'You see the whole organization.';
      case 'subtree':
        return 'You see the parts of the organization you are responsible for.';
      case 'self':
        return 'You see your own location and team.';
      default:
        return '';
    }
  });

  protected readonly canManage = computed(
    () => valueOf(this.detail)?.allowedActions.includes('org.manage') ?? false,
  );
  protected readonly canImport = computed(() => this.session.can('org.manage'));

  // Change form
  protected readonly changeKind = signal<ChangeKind>('rename');
  protected readonly effectiveFrom = linkedSignal(() => this.asOf());
  protected readonly newName = linkedSignal(() => valueOf(this.detail)?.name ?? '');
  protected readonly newParentId = signal<string | null>(null);
  protected readonly newManagerId = linkedSignal(
    () => valueOf(this.detail)?.managerPersonId ?? 'none',
  );
  protected readonly reason = signal('');

  protected readonly moveTargets = computed(() => {
    const d = valueOf(this.detail);
    if (!d) return [];
    return (valueOf(this.units)?.items ?? []).filter((u) => !u.ancestorIds.includes(d.id));
  });

  // Add form
  protected readonly childCode = signal('');
  protected readonly childName = signal('');
  protected readonly childKind = signal<OrgKind>('team');
  protected readonly childKinds = computed(
    () => CHILD_KINDS[valueOf(this.detail)?.kind ?? 'company'],
  );

  protected readonly historyColumns = [
    'from',
    'to',
    'change',
    'name',
    'parent',
    'manager',
    'reason',
  ];

  select(id: string): void {
    this.selectedId.set(id);
    this.mode.set('view');
    this.failure.set(null);
  }

  startChange(): void {
    this.mode.set('change');
    this.changeKind.set('rename');
    this.reason.set('');
    this.notice.set(null);
    this.failure.set(null);
  }

  startAdd(): void {
    this.mode.set('add');
    this.childCode.set('');
    this.childName.set('');
    this.childKind.set(this.childKinds()[0] ?? 'team');
    this.reason.set('');
    this.notice.set(null);
    this.failure.set(null);
  }

  cancel(): void {
    this.mode.set('view');
    this.failure.set(null);
  }

  async saveChange(): Promise<void> {
    const d = valueOf(this.detail);
    if (!d) return;
    const kind = this.changeKind();
    const body = {
      effectiveFrom: this.effectiveFrom(),
      reason: this.reason(),
      ...(kind === 'rename' ? { name: this.newName() } : {}),
      ...(kind === 'move' && this.newParentId() ? { parentId: this.newParentId()! } : {}),
      ...(kind === 'manager'
        ? { managerPersonId: this.newManagerId() === 'none' ? null : this.newManagerId() }
        : {}),
      ...(kind === 'deactivate' ? { deactivate: true as const } : {}),
    };
    await this.run(async () => {
      await data(this.api.changeOrgUnit({ params: { orgUnitId: d.id }, body }));
      this.notice.set(
        kind === 'deactivate'
          ? `${d.name} closes from ${this.effectiveFrom()}.`
          : `${d.name} changes from ${this.effectiveFrom()}. Earlier dates keep the previous values.`,
      );
    });
  }

  async saveChild(): Promise<void> {
    const d = valueOf(this.detail);
    if (!d) return;
    await this.run(async () => {
      const created = await data(
        this.api.createOrgUnit({
          body: {
            code: this.childCode(),
            name: this.childName(),
            kind: this.childKind(),
            parentId: d.id,
            effectiveFrom: this.effectiveFrom(),
            ...(this.reason() ? { reason: this.reason() } : {}),
          },
        }),
      );
      this.notice.set(`${created.name} is part of ${d.name} from ${created.validFrom}.`);
      if (created.validFrom <= this.asOf()) this.selectedId.set(created.id);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.failure.set(null);
    try {
      await action();
      this.mode.set('view');
      this.units.reload();
      this.detail.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
