# Adaptif Eğitim Platformu - Oh My Pi Harness

Bu paket, **Sol orchestrator + Luna Max worker** düzeniyle PDF isterlerindeki Angular 17+ projesini aşamalı geliştirmek için hazırlanmıştır.

## Çalışma düzeni

- Ana oturum: `openai-codex/gpt-5.6-sol:high`
- Uygulama ve test işleri: `adaptive-builder` -> `openai-codex/gpt-5.6-luna:max`
- Faz sonu bağımsız kontrol: `adaptive-auditor` -> `openai-codex/gpt-5.6-luna:max`
- Commit/push: `adaptive-committer` -> `openai-codex/gpt-5.6-luna:low`
- Varsayılan bütçe modu: tek subagent, senkron çalışma, nested agent kapalı
- Caveman: her yanıtta kısa teknik çıktı; araç anlatımı ve tekrar yok

## Kurulum

1. Bu paketin içeriğini Angular proje köküne kopyala. `.omp`, `AGENTS.md` ve `docs` proje kökünde olmalı.
2. Proje henüz yoksa boş klasörde OMP'yi açıp `/adaptive-bootstrap` çalıştır. Sol, Angular kurulumunu ilk work packet olarak Luna'ya verir.
3. OMP'yi güncelle ve giriş yap:

```powershell
omp update
omp
```

OMP içinde:

```text
/login
```

OpenAI Codex OAuth seç.

4. Model adlarını doğrula:

```powershell
omp models openai-codex --json
```

Şunlar görünmeli:

```text
openai-codex/gpt-5.6-sol
openai-codex/gpt-5.6-luna
```

5. Proje kökünde başlat:

```powershell
omp --model openai-codex/gpt-5.6-sol --thinking high
```

## GitHub bağlantısı

Hedef depo:

```text
https://github.com/aalibyrm/staj-v2.git
```

Boş veya harness çıkarılmış proje klasöründe PowerShell:

```powershell
.\scripts\connect-github.ps1
```

Sonra OMP içinde ilk komut:

```text
/adaptive-github-init
```

Bu komut `origin/main` bağlantısını doğrular, yalnızca manifestteki harness dosyalarını ilk commit'e alır ve GitHub'a push eder. Builder commit atmaz. Her doğrulanmış work packet sonunda Sol, Luna Low `adaptive-committer` ajanıyla tek commit ve push yapar. Force push ve otomatik rebase yasaktır.

## Kullanılacak komutlar

```text
/adaptive-github-init
```

Git bağlantısını kurar, ilk harness commit'ini oluşturur ve push eder. Angular geliştirmesine başlamaz.

```text
/adaptive-bootstrap
```

Projeyi inceler, Phase 00 kararlarını çıkarır ve ilk Luna work packet'ını başlatır.

```text
/adaptive-next
```

Mevcut fazdaki sıradaki doğrulanmamış work packet'ı uygular.

```text
/adaptive-review 05
```

Belirtilen fazı gereksinim ve test kapılarına göre denetler. Argüman verilmezse aktif fazı kullanır.

```text
/adaptive-resume
```

Yeni oturumda `STATE.md`, `HANDOFF.md` ve git durumundan devam eder.

```text
/adaptive-status
```

Kod değiştirmeden mevcut faz, aktif paket, blokaj ve sonraki adımı gösterir.

```text
/adaptive-ui-review question-bank
```

Tek ekranı PDF, brief, UI spec ve ilgili tek görsele göre read-only denetler.

## Bütçe modu neden tek worker?

Luna `max` yoğun reasoning kullanır. Paralel iki worker aynı proje bağlamını iki kez okuyarak token tüketimini büyütür. Varsayılan harness bu nedenle `task.maxConcurrency: 1`, `task.batch: false` kullanır. Bağımsız işler için hız gerektiğinde:

```powershell
omp --config .omp/profiles/parallel.yml
```

Bu profil en fazla iki worker açar. Yalnızca dosya kümeleri çakışmıyorsa kullan.

## Kaynakların okunma sırası

Her oturumda tüm PDF özeti okunmaz.

1. `docs/project/STATE.md`
2. `docs/project/HANDOFF.md`
3. Aktif faz dosyası
4. Yalnızca fazın işaret ettiği gereksinim bölümü
5. İhtiyaç varsa traceability matrix

Bu progressive-disclosure düzeni, aynı isterlerin her Luna çağrısında tekrar bağlama yüklenmesini engeller.

## Temel dosyalar

- `AGENTS.md`: Sol ve Luna çalışma sözleşmesi
- `.omp/config.yml`: model ve subagent sınırları
- `.omp/agents/`: Luna builder/auditor tanımları
- `.omp/skills/caveman/`: düşük çıktı tokenı kuralı
- `.omp/skills/adaptive-platform/`: projeye özel on-demand skill
- `.omp/commands/`: kullanıma hazır slash komutları
- `docs/requirements/`: PDF isterlerinin bölünmüş kaynağı
- `docs/plans/`: faz ve work packet planları
- `docs/project/`: karar, durum, risk ve handoff belleği
- `docs/source/project-requirements.pdf`: özgün PDF; yalnız kaynak denetimi/ambiguity için
- `docs/ui/UI-SPEC.md`: bağlayıcı UI tasarım ve erişilebilirlik sistemi
- `docs/ui/screens/`: sekiz route için ekran brief'leri
- `docs/ui/reference/`: sekiz optimize görsel ve contact sheet

## UI referans sistemi

Referans görseller harness'e dahil edilmiştir. UI packet'ı tek bir screen brief ve tek bir WebP kullanır; tüm ekranlar her görevde okunmaz. PDF davranışı her zaman görselden üstündür. Görseldeki kişi, tarih, sayı, ders ve soru metinleri örnek veridir.

Bir ekranı kod değiştirmeden denetlemek için:

```text
/adaptive-ui-review analytics
```

Geçerli key'ler: `general-overview`, `outcome-map`, `question-bank`, `exam-builder`, `exam-session`, `rubric-grading`, `analytics`, `audit-log`.

## İlk çalıştırma

OMP içinde sırasıyla:

```text
/adaptive-github-init
/adaptive-bootstrap
```

Sol önce GitHub bağlantısını ve temiz çalışma ağacını doğrular, sonra repo durumunu belirler. Kod yazmaz; ilk sınırlı görevi `adaptive-builder` ajanına verir. Her işten sonra diff ve testleri kendisi doğrular.
