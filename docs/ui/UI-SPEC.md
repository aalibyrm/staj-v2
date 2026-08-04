# Adaptif Eğitim UI Specification

## 1. Tasarım amacı

Kurumsal eğitim SaaS görünümü: açık tema, yoğun veriyi okunabilir sunan net bilgi hiyerarşisi, erişilebilir durum göstergeleri, tutarlı filtre/tablo/drawer kalıpları. Görsel dil sakin, güvenilir ve uygulama odaklıdır; pazarlama sayfası estetiği değildir.

## 2. Kaynak önceliği

1. PDF işlevsel isterleri ve kabul kriterleri
2. Aktif faz/work packet sözleşmesi
3. Bu UI spec ve ekran brief'i
4. İlgili referans görsel
5. Mevcut uygulama bileşenleri

Referans görsel, iş kuralını değiştiremez. Görsel metinleri/verileri seed-data kaynağı değildir.

## 3. Görsel tokenlar

Aşağıdaki tokenlar başlangıç standardıdır. Kabul edilen UI kütüphanesi bunları CSS custom properties veya theme tokenları üzerinden uygular.

```css
:root {
  --ui-canvas: #f7f9fc;
  --ui-surface: #ffffff;
  --ui-surface-subtle: #f8fafc;
  --ui-border: #e2e8f0;
  --ui-border-strong: #cbd5e1;
  --ui-text: #0f172a;
  --ui-text-muted: #64748b;
  --ui-primary: #146ef5;
  --ui-primary-hover: #0f5bd7;
  --ui-primary-soft: #eef5ff;
  --ui-success: #16a34a;
  --ui-success-soft: #ecfdf3;
  --ui-warning: #f59e0b;
  --ui-warning-soft: #fffbeb;
  --ui-danger: #ef4444;
  --ui-danger-soft: #fff1f2;
  --ui-info: #2563eb;
  --ui-purple: #7c3aed;
  --ui-teal: #0ea5a8;
  --ui-focus: #2563eb;
  --ui-shadow-sm: 0 1px 2px rgb(15 23 42 / 0.05);
  --ui-shadow-md: 0 8px 24px rgb(15 23 42 / 0.08);
  --ui-radius-sm: 8px;
  --ui-radius-md: 12px;
  --ui-radius-lg: 16px;
}
```

Renk tek başına anlam taşımaz. Her durum ikon, metin, desen veya etiketle desteklenir.

## 4. Tipografi

- Font stack: `Inter, Roboto, "Segoe UI", Arial, sans-serif`; yeni ağ font bağımlılığı zorunlu değildir.
- Sayfa başlığı: 24-28 px, 700.
- Bölüm başlığı: 16-18 px, 650-700.
- Kart etiketi/gövde: 13-14 px.
- Yardımcı metin: 12 px; 11 px altına düşme.
- Tablo yoğunluğu okunabilir kalmalı; satır yüksekliği varsayılan 48-56 px.
- Sayısal KPI ve timer değerlerinde `font-variant-numeric: tabular-nums` kullan.

## 5. Spacing ve grid

- Temel birim: 4 px.
- Yaygın aralıklar: 4, 8, 12, 16, 24, 32 px.
- Masaüstü ana içerik: 12 kolon; dış padding 24-32 px.
- Kart iç padding: 16 veya 20 px.
- Sayfa üstü filtre alanı ayrı satır ve gerektiğinde wrap davranışı kullanır.
- Aynı sayfada kart radius, gölge ve border karışımı yapma.

## 6. Uygulama kabuğu

Masaüstü:

- 224-240 px sol sidebar.
- 56-64 px top bar.
- Sidebar: logo, role-aware navigation, daraltma, sistem durumu.
- Top bar: dönem seçici, global arama, bildirim, aktif kullanıcı.
- Aktif menü öğesi yumuşak primary zemin + ikon + metin ile belirtilir.

Tablet:

- Sidebar icon rail veya drawer olur.
- Sağ inspector paneller overlay drawer'a dönüşür.

Mobil:

- Kalıcı sidebar yok; üst app bar + navigation drawer.
- KPI kartları tek kolon/iki kolon.
- Veri tabloları sütun önceliği, kart liste veya kontrollü yatay scroll kullanır.
- Birincil işlem alt sticky action bar olabilir.

## 7. Ortak bileşen kalıpları

Aşağıdaki kalıplar feature içinde yeniden icat edilmez; `shared/ui` veya `shared/patterns` altında tek davranış standardı kullanır:

- App shell ve role-aware nav
- Page header ve breadcrumb/subtitle
- Filter bar + URL query-param senkronizasyonu
- KPI/sparkline card
- Status chip ve severity badge
- Data table + pagination + column priority
- Inspector side panel/drawer
- Chart card + legend + accessible summary
- Loading, slow, empty, error, retry, unauthorized states
- Confirmation dialog
- Zorunlu gerekçe/override paneli
- Stepper ve validation summary
- Autosave/connection status
- Toast/inline notification

UI component strategy kararı kütüphaneyi belirler; bu spec davranış ve görünümü belirler.

## 8. Formlar

- Reactive Forms kullan.
- Label her zaman görünür; placeholder label yerine geçmez.
- Required işareti ve hata metni alanla programatik ilişkilendirilir.
- Cross-field ve domain hataları alan seviyesinde ve üst validation summary içinde görünür.
- Submit sırasında tüm formu kilitleme; yalnızca gerekli kontrolleri ve birincil işlemi busy yap.
- Unsaved/autosave durumu metin + ikonla gösterilir.

## 9. Tablolar ve filtreler

- Search/filter/sort/page URL query parametrelerinde kalır.
- Header sticky olabilir; geniş veri setinde virtual scroll/pagination kararı ölçümle verilir.
- Satır seçimi, hover'dan bağımsız görünür.
- Kebab menü keyboard erişilebilir olur.
- Loading skeleton tablo yapısını korur.
- Empty ve error durumları aynı yüzey içinde görünür; layout zıplaması azaltılır.
- Mobilde en önemli 2-3 alan görünür, diğerleri detail drawer'a taşınır.

## 10. Grafik ve graph

- Grafikler lazy render edilir; görünmez chart işi yapılmaz.
- Renk legend ile birlikte ikon/metin veya desen kullanır.
- Her chart için kısa metinsel özet/accessible table eşdeğeri bulunur.
- Outcome graph yüzlerce node için zoom, fit, focus, filtre, seçili node ve alternatif liste görünümü sunar.
- Graph node kodları benzersizdir; referans görseldeki tekrarlar kopyalanmaz.

## 11. Kritik akış durumları

Her kritik ekran uygun olanları göstermelidir:

- Loading
- Slow response
- Success
- Empty
- Validation error
- Service error
- Retry
- Unauthorized/data-scope denial
- Offline/reconnecting
- Version conflict
- Saving/saved/save failed

Durum ekranları ayrı sonradan yapılan polish değildir; ilgili feature packet'ının kabul parçasıdır.

## 12. Erişilebilirlik

- WCAG AA kontrast hedefi.
- Görünür `:focus-visible` halkası.
- Keyboard sırası görsel sırayla aynı.
- Dialog/drawer açıldığında focus yönetimi; kapanınca tetikleyiciye dönüş.
- Timer, autosave, bağlantı ve hata değişimleri uygun `aria-live` seviyesiyle duyurulur.
- Grafik/heatmap için metin veya tablo eşdeğeri.
- 44x44 px hedef alan önerisi; yoğun tabloda en az 36 px kontrollü hedef.
- Reduced motion tercihine uy.

## 13. Görsel kabul kapısı

UI packet tamamlandı sayılmaz, Sol aşağıdakileri doğrulamadan:

1. Doğru shell, sayfa başlığı ve bilgi hiyerarşisi
2. İlgili referansın ana yerleşim kalıpları
3. Tasarım tokenları ve ortak bileşen kullanımı
4. Loading/empty/error/unauthorized gibi ilgili durumlar
5. Desktop + en az bir dar viewport davranışı
6. Keyboard/focus/ARIA temel kontrolleri
7. PDF iş kurallarıyla çelişen görsel öğe bulunmaması
8. Görsel metin/verilerinin hard-code edilmemesi

## 14. Token politikası

- Worker başına tek ekran görseli.
- Önce screen brief; görsel yalnızca yerleşim/son kontrol için.
- Aynı görseli repair çağrısına yeniden ekleme; `HANDOFF.md` içinde çözümlenmiş UI kararlarını kısa kaydet.
- Görselden renk ölçme veya her pikseli anlatma. `UI-SPEC.md` tokenları normatiftir.
- UI dışı task'larda image read yok.

## 15. Referanslardan çıkarılan component görünümü

- Sidebar yüzeyi beyaz; aktif route `--ui-primary-soft` zemin, primary ikon/metin, 10-12 px radius.
- Top bar ve content arasında ince border; ağır gölge kullanılmaz.
- Kartlar çoğunlukla beyaz + 1 px border + `shadow-sm`; dashboard ana kartlarında `shadow-md` yalnız gerektiğinde.
- Primary button dolu mavi; secondary outline; destructive action kırmızı outline/dolgu ve açık açıklama metni.
- Filter/select/input yükseklikleri 36-44 px; aynı satırdaki kontroller eş yüksekliğe sahip.
- Status chip'ler 24-28 px yükseklik, kısa metin, ikon/dot + label; pastel soft background.
- Inspector genişliği desktop'ta yaklaşık 320-400 px; tablet'te overlay drawer.
- KPI kartlarında ikon kutusu, label, tabular value, trend metni ve küçük sparkline düzeni korunur.
- Dense table header subtle surface kullanır; row selection checkbox + border/background ile görünür.
- Chart kartlarında title, info affordance, filter/action, plot, legend/summary sırası tutarlıdır.
- İkonlar tek aileden seçilir; 18-20 px varsayılan, dekoratif olmayan ikonlarda erişilebilir label/tooltip sağlanır.

## 16. Shell tutarlılık kararı

`01-general-overview.webp` global shell anchor'ıdır. Diğer referanslarda görülen sidebar/topbar farkları route ve rol gereği uyarlanır; her feature kendi shell kopyasını oluşturmaz. Student exam session daha odaklı olabilir ancak aynı token, typography ve status component sistemini kullanır.
