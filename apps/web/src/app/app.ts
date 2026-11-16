import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InstallPrompt } from '@bf/web/data-access';

/** Root: the shell (signed in) or the public sign-in pages, chosen by the router. */
@Component({
  selector: 'bf-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    // Created at start-up so the browser's one-time install event is not missed (059a).
    inject(InstallPrompt);
  }
}
