# Screen Brief: Audit Log

- `ui-key`: `audit-log`
- Route: `/audit`
- Primary roles: administrator and explicitly permitted auditor roles
- Reference: `docs/ui/reference/08-audit-log.webp`
- Primary phase: 06

## Purpose

Publish, score override, session termination, import, permission denial ve diğer kritik işlemleri değiştirilemez, filtrelenebilir kayıtlarla gösterir.

## Required regions

- Date/actor/entity/event/class/search filters; URL query params
- Activity summary by category/time
- Audit table: time, actor, action, target, description, status
- Selected event detail drawer: old/new values, reason, target, trace identifiers
- Export and pagination controls subject to permission

## Required behavior

Audit records append-only/read-only. Sensitive fields permission/data scope ile redacted. Old/new values human-readable. Empty/error/unauthorized states differ.

## Responsive

Detail overlay drawer. Table priority fields time/action/target/status; remaining data detail panelında.

## Prohibitions

- Gerçek PII, IP, token veya secret seed data'ya yazılmaz.
- Audit row edit/delete action sunulmaz.
