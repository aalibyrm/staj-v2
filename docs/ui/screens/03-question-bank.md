# Screen Brief: Question Bank

- `ui-key`: `question-bank`
- Route: `/questions`
- Primary roles: instructor, content editor, administrator
- Reference: `docs/ui/reference/03-question-bank.webp`
- Primary phase: 03

## Purpose

Soru bankasını arama, filtreleme, sayfalama, sürüm/publish durumu ve seçili soru inspector'ı ile yönetir.

## Required regions

- Search, course/grade/difficulty/status filters; URL query params
- Status count chips
- Question data table with ID, outcome, type, difficulty, status, version, updated time
- Selection and bulk action affordance
- Right inspector tabs: preview, metadata, versions
- Publish/version action and pagination

## Required behavior

Published question immutable. Edit action creates new version; old exam snapshot remains bağlı. Partial bulk failures explicit. Permission and data scope actions disable/hide with reason.

## States

Loading, empty filter result, service error/retry, unauthorized, selected item missing, stale/version conflict.

## Responsive

Inspector overlay drawer. Table shows ID, title/outcome, status first; other fields detail panelına taşınır.

## Prohibitions

- Referans soru metni/doğru cevap seed olarak zorunlu değildir.
- Published row doğrudan edit moduna açılmaz.
