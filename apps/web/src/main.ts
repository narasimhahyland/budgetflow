import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

// Installable app (059a): the service worker caches the app shell (never API data) and shows Web
// Push notifications. Production builds only: the dev server's bundles are not hashed, so a cached
// copy would hide edits.
if (!isDevMode() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('Service worker not registered', err));
  });
}
