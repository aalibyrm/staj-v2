import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AuditPort } from './core/observability/observability.ports';
import { AuditLogRepository } from './features/audit/data-access/audit-log.repository';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), { provide: AuditPort, useExisting: AuditLogRepository }]
};
