# Screen Brief: Rubric Grading

- `ui-key`: `rubric-grading`
- Route: `/grading/:attemptId`
- Primary roles: instructor, evaluator, administrator according to scope
- Reference: `docs/ui/reference/06-rubric-grading.webp`
- Primary phase: 06

## Purpose

Açık uçlu cevabı rubrik kriterleriyle puanlar, toplamı hesaplar, geri bildirim ve yeniden değerlendirme/audit geçmişi sağlar.

## Required regions

- Question and student response preview
- Rubric matrix: criterion, weight, levels, selected score, weighted score
- Total score summary
- Feedback form
- Student/exam/progress sidebar
- Previous score history and audit/re-evaluation actions
- Mandatory reason panel for score override

## Required behavior

Totals pure selector/function ile hesaplanır. Approved score change reason olmadan kaydedilemez. Optimistic update failure rolls back. Actor/time/old/new values audit'e yazılır.

## Responsive

Rubric matrix becomes stacked criterion cards or controlled horizontal table. Summary/actions sticky olabilir.

## Prohibitions

- Onaylanmış değişiklik sessiz overwrite edilmez.
- Renkli seçili hücre tek seçim göstergesi değildir.
