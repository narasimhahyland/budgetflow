import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { AuthService } from '@bf/web/data-access';
import { BudgetFlowTitleStrategy } from '@bf/web/shell';
import { provideSatoriIcons } from '@hylandsoftware/satori-ui/icons';
import { provideSatoriIllustrations } from '@hylandsoftware/satori-ui/illustration';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideAndConfigureSatoriTranslations } from '@hylandsoftware/satori-ui/translations';
import { appRoutes } from './app.routes';

// Satori theme and icons, illustrations, and English defaults for Satori's own component strings
// (@ngx-translate/core is only Satori's peer; app copy is plain English in templates).
// Sign-in (OIDC code + PKCE against Keycloak) completes in the app initializer, before routing.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => inject(AuthService).init()),
    provideRouter(appRoutes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: BudgetFlowTitleStrategy },
    provideSatori(),
    provideSatoriIcons(),
    provideSatoriIllustrations(),
    provideAndConfigureSatoriTranslations({ fallbackLang: 'en' }),
  ],
};
