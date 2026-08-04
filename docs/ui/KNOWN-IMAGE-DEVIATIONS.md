# Known Image Deviations

Üretilmiş ekranlardaki aşağıdaki ayrıntılar kopyalanmaz. Bu dosya PDF veya domain kurallarını değiştirmez; görsel üretim artefaktlarını sınırlar.

## Global

- Görsel metin, tarih, sayı, kişi, ders, sınıf ve ID'ler temsili seed veridir.
- Yazım/etiket hataları düzeltilir; görseldeki metin source-of-truth değildir.
- `Ayşe Aydın / Yönetici` tüm ekranların gerçek aktif rolü değildir; role göre header değişir.
- Sidebar menü görünürlüğü route/action/data-scope yetkisine göre hesaplanır.
- Durumlar yalnız renkle anlatılmaz.

## 02 Outcome map

- Tekrarlanan kazanım kodları kullanılmaz; her outcome ID/kodu benzersizdir.
- Node ilişkileri gerçek seed graph ve cycle kurallarından gelir.

## 03 Question bank

- Örnek doğru cevap ve biyoloji metni yalnız mock içeriktir.
- Yayınlanmış soru doğrudan düzenlenmez; yeni versiyon akışı korunur.

## 04 Exam builder

- Ders/kazanım eşleşmeleri örnektir; domain ilişkileri gerçek seed data ile doğrulanır.
- Blueprint eksikleri non-color metin/ikonla açıklanır; invalid sınav yayınlanamaz.

## 05 Exam session

- Aktif sınav sırasında `Çözümü Göster` sunulmaz.
- Cevabın doğru/yanlış olduğu submission öncesinde gösterilmez.
- Header rolü öğrenci olmalıdır; yönetici örneği kopyalanmaz.
- Device clock değil synchronized reference time kullanılır.
- Sınav bitirme confirmation ve geç cevap engeli PDF kurallarına uyar.

## 06 Rubric grading

- Öğrenci/sınıf/sınav metinleri temsili.
- Puan değişikliği gerekçesi zorunlu; onay/audit kuralları görselden değil domain'den gelir.

## 07 Analytics

- Gizlilik eşiği görseldeki `500` olmak zorunda değildir; kabul edilen domain ayarı kullanılır.
- Öneriler açıklanabilir rule engine sonucudur; statik kart metni hard-code edilmez.

## 08 Audit

- IP, trace ID ve kullanıcı bilgileri demo veridir; gerçek secret/PII repoya yazılmaz.
- Audit kayıtları değiştirilemez ve yetki kapsamıyla filtrelenir.
