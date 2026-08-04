# Screen Brief: Exam Builder

- `ui-key`: `exam-builder`
- Route: `/exams/new` and `/exams/:id/edit`
- Primary roles: instructor, program owner
- Reference: `docs/ui/reference/04-exam-builder.webp`
- Primary phase: 04

## Purpose

Blueprint kısıtlarını tanımlar, hedef/mevcut dağılımı karşılaştırır, soruları deterministik seçer ve geçerli sınavı yayınlar.

## Required regions

- Multi-step flow: blueprint, question selection, settings, publish review
- Target/current coverage matrix with missing/excess reasons
- Automatic selection action and selected question pool
- Exam settings Reactive Form
- Validation summary: valid, partial, missing
- Draft save and publish actions

## Required behavior

No duplicate question. Unsatisfied constraints list exact reasons. Invalid blueprint publish edilemez. Published exam immutable/versioned. Publish creates confirmation and audit event.

## Responsive

Settings panel moves below content or overlay drawer. Matrix supports controlled horizontal scroll with sticky first columns.

## Prohibitions

- Görseldeki sample distribution domain kuralı sayılmaz.
- Sadece renkli hücreyle geçerlilik anlatılmaz.
