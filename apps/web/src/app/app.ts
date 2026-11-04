import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SatEmptyState } from '@hylandsoftware/satori-ui/empty-state';

/** Placeholder until Phase 2 builds the Satori platform shell (navigation, header, switchers, sign-in). */
@Component({
  selector: 'bf-root',
  imports: [RouterOutlet, SatEmptyState],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
