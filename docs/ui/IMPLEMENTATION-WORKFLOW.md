# UI Implementation Workflow

Bu akış, referans görselleri kullanırken Sol/Luna token tüketimini ve gereksiz yeniden yapımı sınırlar.

## Kaynak önceliği

1. PDF gereksinimleri ve kabul kriterleri
2. Aktif work packet ve requirement ID'leri
3. `docs/ui/UI-SPEC.md`
4. İlgili `docs/ui/screens/*.md` brief'i
5. İlgili tek `docs/ui/reference/*.webp` görseli
6. Mevcut ortak bileşenler ve uygulama konvansiyonları

Görsel iş kuralı değildir. Görsel ile PDF çelişirse PDF uygulanır ve sapma kaydedilir.

## Sol akışı

UI içeren her packet için Sol sözleşmeye şunları ekler:

```text
ui-key: question-bank
ui-brief: docs/ui/screens/03-question-bank.md
ui-reference: docs/ui/reference/03-question-bank.webp
visual-scope: liste + inspector; tam editör kapsam dışı
viewports: 1440x900, 900x1000
states: loading, empty, error, unauthorized
```

Sol:

1. Önce brief ve UI spec'i okur; tüm görselleri açmaz.
2. Bir packet'a yalnız birincil tek referans görsel verir.
3. Shared primitive gerekiyorsa önce onu küçük bir packet olarak çıkarır.
4. Luna diff'ini, davranış testlerini ve görsel hiyerarşiyi ayrı ayrı doğrular.
5. Referanstan bilinçli sapmayı `HANDOFF.md` içinde tek satırla kaydeder.
6. UI gate geçmeden commit/push yaptırmaz.

## Luna akışı

1. `UI-SPEC.md` içinden yalnız ilgili bölümleri oku.
2. İlgili screen brief'i oku.
3. İlgili tek WebP'yi yerleşim ve hiyerarşi için incele.
4. Mevcut shared bileşenleri ara; benzer primitive'i yeniden üretme.
5. Önce davranış ve state akışını kur, sonra stil katmanını uygula.
6. Desktop ve bir dar viewport davranışını aynı packet'ta doğrula.
7. Görseldeki örnek kişi, sayı, metin ve tarihleri hard-code etme.

## Token koruması

- UI dışı packet'ta `docs/ui/reference` açılmaz.
- Bir worker çağrısında sekiz ekran veya contact sheet açılmaz.
- `00-contact-sheet.webp` yalnız shell tutarlılığı veya Phase 08 sweep için kullanılır.
- Repair çağrısında aynı görsel tekrar yüklenmez; parent task yerleşim kararlarını 8 satırdan kısa özetler.
- Piksel/padding tahmini için uzun görüntü betimlemesi üretilmez; `UI-SPEC.md` tokenları kullanılır.
- Ekran metni OCR ile çıkarılmaz; screen brief ve domain verisi kullanılır.

## Görsel doğrulama

Tercih edilen kanıt sırası:

1. Component/unit test
2. Production build
3. Route'u 1440x900 ve 900x1000 viewport'ta çalıştırma
4. Uygulama screenshot'ı ile referansın bilgi hiyerarşisini karşılaştırma
5. Keyboard/focus ve ilgili state kontrolleri

Pixel-perfect eşleşme aranmaz. Shell, bilgi önceliği, yoğunluk, ortak component dili, responsive dönüşüm ve erişilebilirlik aranır.
