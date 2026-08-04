# Screen Reference Map

| Key | Route | Faz | Birincil rol | Brief | Tek görsel |
|---|---|---:|---|---|---|
| `general-overview` | `/overview` | 01 shell, 07 data | role-scoped staff | `screens/01-general-overview.md` | `reference/01-general-overview.webp` |
| `outcome-map` | `/outcomes/map` | 02 | instructor/program owner | `screens/02-outcome-map.md` | `reference/02-outcome-map.webp` |
| `question-bank` | `/questions` | 03 | instructor/content editor | `screens/03-question-bank.md` | `reference/03-question-bank.webp` |
| `exam-builder` | `/exams/new` | 04 | instructor/program owner | `screens/04-exam-builder.md` | `reference/04-exam-builder.webp` |
| `exam-session` | `/exams/:examId/session` | 05 | student | `screens/05-exam-session.md` | `reference/05-exam-session.webp` |
| `rubric-grading` | `/grading/:attemptId` | 06 | evaluator/instructor | `screens/06-rubric-grading.md` | `reference/06-rubric-grading.webp` |
| `analytics` | `/analytics` | 07 | scoped staff/observer | `screens/07-analytics.md` | `reference/07-analytics-recommendations.webp` |
| `audit-log` | `/audit` | 06 | administrator/auditor | `screens/08-audit-log.md` | `reference/08-audit-log.webp` |

## Work packet contract

```text
ui-key: question-bank
ui-brief: docs/ui/screens/03-question-bank.md
ui-reference: docs/ui/reference/03-question-bank.webp
visual-scope: list + inspector; full editor dialog out of scope
viewports: 1440x900, 900x1000
states: loading, empty, error, unauthorized, stale selection
```

Bir packet'ta birincil tek görsel kullanılır. İkinci görsel yalnız ortak shell karşılaştırması zorunluysa Sol tarafından açıkça izin verilir. Görsel daha önce aynı route için çözümlendiyse sonraki behavior packet'ları `HANDOFF.md` kararlarını kullanır ve görseli yeniden açmaz.
