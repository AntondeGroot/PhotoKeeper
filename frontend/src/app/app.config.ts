import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';

import { routes } from './app.routes';
import { authRefreshInterceptor } from './auth-refresh.interceptor';
import { ReminderSchedulerService } from './notifications/reminder-scheduler.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withXhr(), withInterceptors([authRefreshInterceptor])),
    // Constructed for its side effect: it starts watching the reminder prefs and keeps the OS holding
    // the matching daily alarms. Nothing ever reads it back, so it needs a deliberate bootstrap rather
    // than an injection into a component that doesn't use it.
    provideAppInitializer(() => {
      inject(ReminderSchedulerService);
    }),
  ],
};
