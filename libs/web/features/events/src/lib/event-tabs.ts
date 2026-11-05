import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

export type EventSection = 'overview' | 'plan' | 'people' | 'quotes' | 'feedback' | 'scorecard';

/** The sections of one event (46, 46b, 47a-47e, 51a, 54a, 54b), shared by every event sub-page. */
@Component({
  selector: 'bf-event-tabs',
  imports: [RouterLink, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs class="bf-tabs" aria-label="Event sections">
      <a satNavigationTab [active]="section() === 'overview'" [routerLink]="['/events', eventId()]"
        >Overview</a
      >
      <a
        satNavigationTab
        [active]="section() === 'plan'"
        [routerLink]="['/events', eventId(), 'plan']"
        >Plan</a
      >
      <a
        satNavigationTab
        [active]="section() === 'people'"
        [routerLink]="['/events', eventId(), 'people']"
        >People</a
      >
      <a
        satNavigationTab
        [active]="section() === 'quotes'"
        [routerLink]="['/events', eventId(), 'quotes']"
        >Quotes</a
      >
      <a
        satNavigationTab
        [active]="section() === 'feedback'"
        [routerLink]="['/events', eventId(), 'feedback']"
        >Feedback</a
      >
      @if (showScorecard()) {
        <a
          satNavigationTab
          [active]="section() === 'scorecard'"
          [routerLink]="['/events', eventId(), 'scorecard']"
          >Scorecard</a
        >
      }
    </sat-navigation-tabs>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTabs {
  readonly eventId = input.required<string>();
  readonly section = input.required<EventSection>();
  /** The ROI scorecard opens once the event is completed, and is final at closed. */
  readonly showScorecard = input(true);
}
