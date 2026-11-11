import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { RuleEffect, RuleStatus } from '@bf/contracts';
import type { StatusTone } from '@bf/web/ui';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { EFFECT_LABELS, STATUS_LABELS } from './labels';

interface TagLook {
  tone: StatusTone;
  icon: string;
}

// Section 5 and 8 of the design system: a hard block is the strongest tone with a block icon, a hold
// is the frozen treatment (info with a lock), a soft warning is warning, an approval waits (clock).
// Satori tags have no error tone, so important-loud stands in for the error container.
const EFFECT_LOOKS: Record<RuleEffect, TagLook> = {
  block: { tone: 'important-loud', icon: 'block' },
  freeze: { tone: 'info', icon: 'lock' },
  require_approval: { tone: 'warning', icon: 'clock' },
  warn: { tone: 'warning', icon: 'critical' },
  auto_approve: { tone: 'success', icon: 'circle_check' },
};

const STATUS_LOOKS: Record<RuleStatus, TagLook> = {
  draft: { tone: 'neutral', icon: 'note_edit' },
  scheduled: { tone: 'info', icon: 'calendar' },
  active: { tone: 'success', icon: 'circle_check' },
  expired: { tone: 'neutral', icon: 'timer_off' },
  retired: { tone: 'neutral', icon: 'archive' },
};

/** What a rule does to a request, as a Satori status tag with its own icon. */
@Component({
  selector: 'bf-rule-effect',
  imports: [MatIconModule, SatStatusTag],
  template: `<sat-status-tag [status]="look().tone"
    ><mat-icon [svgIcon]="look().icon" aria-hidden="true" />{{ label() }}</sat-status-tag
  >`,
  styles: `
    :host {
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleEffectTag {
  readonly effect = input.required<RuleEffect>();
  protected readonly look = computed(() => EFFECT_LOOKS[this.effect()]);
  protected readonly label = computed(() => EFFECT_LABELS[this.effect()]);
}

/** Where a rule or one of its versions sits in its life: draft, starts later, active, replaced, retired. */
@Component({
  selector: 'bf-rule-status',
  imports: [MatIconModule, SatStatusTag],
  template: `<sat-status-tag [status]="look().tone"
    ><mat-icon [svgIcon]="look().icon" aria-hidden="true" />{{ label() }}</sat-status-tag
  >`,
  styles: `
    :host {
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleStatusTag {
  readonly status = input.required<RuleStatus>();
  protected readonly look = computed(() => STATUS_LOOKS[this.status()]);
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
