# Screen Brief: Analytics and Adaptive Recommendations

- `ui-key`: `analytics`
- Route: `/analytics`
- Primary roles: instructor, program owner, administrator, observer with scoped data
- Reference: `docs/ui/reference/07-analytics-recommendations.webp`
- Primary phase: 07

## Purpose

Mastery trendlerini, outcome/class heatmap'ini, riskleri ve açıklanabilir adaptif önerileri rol/veri kapsamıyla sunar.

## Required regions

- Cohort/class/date/course filters; URL query params
- KPI cards
- Mastery trend chart with accessible summary
- Outcome-by-class heatmap/table equivalent
- Explainable recommendation list with reason codes
- Privacy-threshold comparison message
- Risky students/classes tables according to permission

## Required behavior

Recommendation engine rule-based, deterministic and explainable. Completed/locked content excluded. Privacy threshold boundary test edilir; eşik altındaysa individual comparison hiç render edilmez.

## Responsive

Charts stack; heatmap controlled scroll/table alternative. Recommendation panel normal content flow'a iner.

## Prohibitions

- Görseldeki `500` gizlilik eşiği otomatik domain kararı değildir.
- Statik recommendation text hard-code edilmez.
