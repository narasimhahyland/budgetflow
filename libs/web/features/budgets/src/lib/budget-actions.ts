import { inject, Injectable, type Type } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { BudgetDetail } from '@bf/contracts';
import { firstValueFrom } from 'rxjs';
import { FreezeDialog, ReduceDialog, RestoreDialog, ZeroDialog } from './control-dialogs';
import { AllocateDialog, IncreaseDialog, ReleaseDialog, TransferDialog } from './money-dialogs';
import { RollForwardDialog, SettingsDialog } from './settings-dialogs';

/** Opens the budget dialogs; each resolves true when it changed something (callers reload). */
@Injectable({ providedIn: 'root' })
export class BudgetActions {
  private readonly dialog = inject(MatDialog);

  private open<T>(component: Type<T>, data: unknown, width = '960px'): Promise<boolean> {
    const ref = this.dialog.open<T, unknown, boolean>(component, {
      data,
      width,
      maxWidth: '96vw',
      autoFocus: 'dialog',
    });
    return firstValueFrom(ref.afterClosed()).then((r) => r === true);
  }

  allocate(parent: BudgetDetail, childId?: string) {
    return this.open(AllocateDialog, { parent, childId });
  }
  transfer(budget: BudgetDetail) {
    return this.open(TransferDialog, { budget });
  }
  reduce(budget: BudgetDetail) {
    return this.open(ReduceDialog, { budget });
  }
  freeze(budget: BudgetDetail) {
    return this.open(FreezeDialog, { budget }, '840px');
  }
  zero(budget: BudgetDetail) {
    return this.open(ZeroDialog, { budget });
  }
  restore(budget: BudgetDetail) {
    return this.open(RestoreDialog, { budget, mode: 'restore' }, '520px');
  }
  increase(budget: BudgetDetail) {
    return this.open(IncreaseDialog, { budget });
  }
  release(budget: BudgetDetail) {
    return this.open(ReleaseDialog, { budget }, '560px');
  }
  /** Controls and alerts open as a 480px side sheet on the right (section 11 drawer). */
  settings(budget: BudgetDetail) {
    const ref = this.dialog.open<SettingsDialog, unknown, boolean>(SettingsDialog, {
      data: { budget },
      width: '480px',
      maxWidth: '100vw',
      height: '100%',
      position: { top: '0', right: '0' },
      autoFocus: 'dialog',
    });
    return firstValueFrom(ref.afterClosed()).then((r) => r === true);
  }
  rollForward(budget: BudgetDetail) {
    return this.open(RollForwardDialog, { budget }, '720px');
  }
}
