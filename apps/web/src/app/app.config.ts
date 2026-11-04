import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideSatoriIllustrations } from '@hylandsoftware/satori-ui/illustration';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideAndConfigureSatoriTranslations } from '@hylandsoftware/satori-ui/translations';
import { appRoutes } from './app.routes';

// Satori theme and icons, illustrations, and English defaults for Satori's own component strings
// (@ngx-translate/core is only Satori's peer; app copy is plain English in templates).
// Phase 2 adds the HTTP client with auth and tenant interceptors and OIDC sign-in.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideSatori(),
    provideSatoriIllustrations(),
    provideAndConfigureSatoriTranslations({ fallbackLang: 'en' }),
  ],
};
