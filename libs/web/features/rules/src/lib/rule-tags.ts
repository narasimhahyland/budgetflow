import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RuleEffect, RuleStatus } from '@bf/contracts';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { EFFECT_LABELS, STATUS_LABELS } from './labels';

type Tone = 'important' | 'warning' | 'success' | 'info' | 'neutral' | 'neutral-quiet';

const EFFECT_TONES: Record<RuleEffect, Tone> = {
  block: 'important',
  freeze: 'important',
  require_approval: 'warning',
  warn: 'info',
  auto_approve: 'success',
};

const STATUS_TONES: Record<RuleStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  active: 'success',
  expired: 'neutral-quiet',
  retired: 'neutral-quiet',
};

/** What a rule does to a request, as a Satori status tag. */
@Component({
  selector: 'bf-rule-effect',
  imports: [SatStatusTag],
  template: `<sat-status-tag [status]="tone()">{{ label() }}</sat-status-tag>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleEffectTag {
  readonly effect = input.required<RuleEffect>();
  protected readonly tone = computed(() => EFFECT_TONES[this.effect()]);
  protected readonly label = computed(() => EFFECT_LABELS[this.effect()]);
}

/** Where a rule or one of its versions sits in its life: draft, starts later, active, replaced, retired. */
@Component({
  selector: 'bf-rule-status',
  imports: [SatStatusTag],
  template: `<sat-status-tag [status]="tone()">{{ label() }}</sat-status-tag>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleStatusTag {
  readonly status = input.required<RuleStatus>();
  protected readonly tone = computed(() => STATUS_TONES[this.status()]);
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
