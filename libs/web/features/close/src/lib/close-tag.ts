import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import type { Tag } from './close-format';

/** A close, forecast or year-end status as a Satori status tag with its own icon and text. */
@Component({
  selector: 'bf-close-tag',
  imports: [MatIconModule, SatStatusTag],
  template: `
    @let t = tag();
    <sat-status-tag [status]="t.tone"
      ><mat-icon [svgIcon]="t.icon" aria-hidden="true" />{{ t.text }}</sat-status-tag
    >
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloseTag {
  readonly tag = input.required<Tag>();
}
