import { provideAppInitializer } from '@angular/core';

export interface AppConfig {
  /** Base URL of the API, without a trailing slash. */
  apiBaseUrl: string;
}

let loaded: AppConfig = { apiBaseUrl: 'http://localhost:8080' };

/** Read at request time (never captured at construction), so it is correct whenever the initializer finishes. */
export function apiBaseUrl(): string {
  return loaded.apiBaseUrl;
}

/** Test seam: set the base URL a spec expects. */
export function setApiBaseUrlForTests(url: string): void {
  loaded = { apiBaseUrl: url };
}

/**
 * Runtime configuration: /config.json is fetched before the first route renders, so the same build can point at a local
 * API or a deployed one with no rebuild and no environment-specific value baked into the bundle. A missing or broken
 * file falls back to the local default instead of leaving the app unable to start.
 */
export function provideAppConfig() {
  return provideAppInitializer(async () => {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const cfg = (await res.json()) as Partial<AppConfig>;
        if (typeof cfg.apiBaseUrl === 'string' && cfg.apiBaseUrl.length > 0) {
          loaded = { apiBaseUrl: cfg.apiBaseUrl.replace(/\/+$/, '') };
        }
      }
    } catch {
      // keep the default
    }
  });
}
