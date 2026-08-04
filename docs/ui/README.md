# UI Reference Pack

Bu klasör, projeye özel üretilmiş sekiz masaüstü ekran referansını, ekran brief'lerini ve Angular uygulamasına dönüştürme kurallarını içerir.

## Yetki sınırı

- PDF isterleri ürün davranışı, iş kuralı, yetki, hata durumu ve kabul kriterlerinde birincil kaynaktır.
- `UI-SPEC.md` görsel sistem, yerleşim, bileşen davranışı, responsive ve erişilebilirlik yönlendirmesinde birincil UI kaynağıdır.
- `screens/*.md` her route'un uygulanabilir ekran sözleşmesidir.
- Görseller yerleşim, yoğunluk ve bilgi hiyerarşisi referansıdır. Görseldeki örnek metin, sayı, tarih, kullanıcı, ders ve veri kayıtları gereksinim değildir.
- Görselde PDF ile çelişen/güvenli olmayan öğe uygulanmaz. Sapmalar `KNOWN-IMAGE-DEVIATIONS.md` içinde yazılıdır.
- Pixel-perfect kopya hedeflenmez. Aynı tasarım dili, component ailesi, bilgi hiyerarşisi ve etkileşim kalıbı hedeflenir.

## Token tasarruflu okuma

UI işi olmayan packet bu klasörü açmaz.

UI packet okuma sırası:

1. `skill://adaptive-ui`
2. `UI-SPEC.md`
3. `SCREEN-REFERENCE-MAP.md`
4. Yalnız ilgili `screens/<screen>.md`
5. Yalnız ilgili tek `reference/<screen>.webp`
6. Gerekiyorsa `KNOWN-IMAGE-DEVIATIONS.md`

`00-contact-sheet.webp` yalnız global shell tutarlılığı veya Phase 08 sweep sırasında açılır. Sekiz ekran aynı worker çağrısına yüklenmez.

## Ana dosyalar

- `IMPLEMENTATION-WORKFLOW.md`: Sol/Luna UI geliştirme ve doğrulama akışı
- `UI-SPEC.md`: tasarım tokenları, ortak component kuralları, responsive/a11y
- `SCREEN-REFERENCE-MAP.md`: route/faz/brief/görsel eşlemesi
- `screens/`: route bazlı davranış ve görsel kapsam brief'leri
- `reference/`: optimize edilmiş 1280x800 WebP referansları
- `VISUAL-QA.md`: packet ve release kontrol listesi
- `KNOWN-IMAGE-DEVIATIONS.md`: kopyalanmaması gereken üretim artefaktları

## UI inceleme komutu

Uygulanan bir ekranı kod değiştirmeden denetlemek için:

```text
/adaptive-ui-review question-bank
```

Geçerli key'ler: `general-overview`, `outcome-map`, `question-bank`, `exam-builder`, `exam-session`, `rubric-grading`, `analytics`, `audit-log`.
