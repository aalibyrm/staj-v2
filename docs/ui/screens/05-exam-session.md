# Screen Brief: Exam Session

- `ui-key`: `exam-session`
- Route: `/exams/:examId/session`
- Primary role: student
- Reference: `docs/ui/reference/05-exam-session.webp`
- Primary phase: 05

## Purpose

Öğrencinin zaman senkronlu, autosave/offline/conflict güvenli sınav oturumunu yönetir.

## Required regions

- Student-specific focused header; exam title, progress, reference-time timer
- Autosave and connection status with aria-live
- Question navigator: answered/current/unanswered/flagged
- Question content and answer control
- Previous/next/flag actions
- Session summary and finish confirmation

## Required behavior

One active session per student+exam. Timer device clock'a güvenmez. Offline answer queue ordered/idempotent replay yapar. Conflict local/server choices gösterir. Deadline sonrası cevap kabul edilmez.

## States

Saving, saved, save failed, offline, reconnecting, conflict, expired, terminated, submitted.

## Responsive

Question navigator collapsible drawer; timer and save state sticky. Touch targets accessible.

## Prohibitions

- Aktif sınavda `Çözümü Göster` yok.
- Submission öncesi doğru/yanlış işareti yok.
- Yönetici avatar/rolü kullanılmaz.
