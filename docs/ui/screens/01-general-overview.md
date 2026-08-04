# Screen Brief: General Overview

- `ui-key`: `general-overview`
- Route: `/overview`
- Primary roles: administrator, instructor, program owner; visible cards/data role scope ile değişir
- Reference: `docs/ui/reference/01-general-overview.webp`
- Primary phases: 01 shell, 07 analytics

## Purpose

Kullanıcının rol kapsamındaki aktif öğrenci, sınav, soru bankası, yetkinlik, risk ve sistem etkinliği özetini tek ekranda sunar. Bu ekran global shell'in görsel standardını belirler.

## Required regions

- Role-aware left navigation and top bar
- Page header, term/class/course/date filters; URL query-param sync
- KPI cards with non-color trend indicators
- Mastery/progress chart with accessible text summary
- Upcoming exams list
- Risky outcomes list
- System activity feed

## Required states

Loading skeleton, empty cohort, partial widget failure, unauthorized card/data-scope denial, slow response and retry. One failed widget must not blank the whole page.

## Responsive

Desktop 12-column dashboard. Tablet cards wrap and side-by-side charts stack. Mobile nav drawer, KPI 1-2 columns, tables become priority lists.

## Prohibitions

- Görseldeki sayılar ve `Ayşe Aydın` hard-code edilmez.
- Tüm roller aynı kartları görmez.
- Chart yalnız renk veya canvas içeriğiyle açıklanmaz.
