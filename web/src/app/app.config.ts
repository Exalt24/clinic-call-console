import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideAppConfig } from './core/app-config';
import { authInterceptor, errorInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppConfig(),
    // withComponentInputBinding lets a route's :id and resolved data arrive as plain component inputs
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // order matters: the error interceptor sees the response of a request the auth interceptor already decorated
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
  ],
};
