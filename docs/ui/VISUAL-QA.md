# Visual QA Checklist

## Her UI packet

- [ ] Doğru `ui-key`, brief ve tek görsel kullanıldı.
- [ ] PDF/requirement ID ile çelişen görsel öğe uygulanmadı.
- [ ] Shared token/component kullanıldı; feature içinde kopya primitive oluşturulmadı.
- [ ] Shell ve page hierarchy: title, subtitle, actions, filters, primary content net.
- [ ] Loading, empty, slow, error, retry, unauthorized ve domain state'lerinden ilgili olanlar var.
- [ ] 1440x900 masaüstü ve 900x1000 dar viewport kontrol edildi veya packet farklı hedef belirtti.
- [ ] Keyboard sırası, `focus-visible`, dialog/drawer focus return kontrol edildi.
- [ ] Metin taşması, kontrollü yatay scroll ve tablo sütun önceliği kontrol edildi.
- [ ] Durumlar renk dışında ikon/metin/etiket taşıyor.
- [ ] Screenshot örnek verisi hard-code edilmedi; facade/store verisi kullanılıyor.
- [ ] Chart/graph için metin/tablo eşdeğeri veya erişilebilir özet var.
- [ ] Referansın ana bilgi hiyerarşisi korunurken responsive dönüşüm tanımlı.
- [ ] `KNOWN-IMAGE-DEVIATIONS.md` ihlali yok.

## Görsel kanıt

Mümkünse route screenshot'ı 1440x900 ve 900x1000 alınır. Kanıt build/temp çıktısı olarak kalır; kullanıcı açıkça baseline istemedikçe repoya commit edilmez. Karşılaştırma pixel diff değil, aşağıdaki başlıklardadır:

- shell ve navigasyon
- ana bölge oranları
- bilgi önceliği ve yoğunluk
- ortak component dili
- durum/validation görünürlüğü
- responsive dönüşüm

## Phase 08 tüm ekran sweep

- [ ] `00-contact-sheet.webp` yalnız cross-screen tutarlılık için açıldı.
- [ ] Shell/nav/header tüm ekranlarda aynı token ve ölçüleri kullanıyor.
- [ ] Kart, chip, form, table, drawer, dialog ve status varyantları tutarlı.
- [ ] Responsive navigation ve sağ panel dönüşümü tutarlı.
- [ ] Chart/graph metin eşdeğeri, reduced motion ve lazy render mevcut.
- [ ] Exam session student role ve güvenli feedback kurallarına uyuyor.
- [ ] Screenshot/visual regression artefaktları yanlışlıkla commit edilmedi.
