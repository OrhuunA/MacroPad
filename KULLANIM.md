# MacroPad — Electron arayüz + Python motor

Klavye ve fare makroları: metin yazdırma, tıklama, bekleme, tuş ve kombinasyonlar.
Adımları sıraya dizip tek makro olarak çalıştırırsın.

```
macropad-electron/
├── main.js            Electron ana süreç (pencere + Python motorunu başlatır)
├── preload.js         Güvenli IPC köprüsü
├── renderer/          Arayüz (index.html, style.css, app.js)
├── engine/engine.py   Python motoru — klavye/fare işini bu yapar (pynput)
├── calistir.bat       Geliştirme modunda çalıştır
└── exe_olustur.bat    Windows kurulum paketi üret
```

Arayüz ile motor, stdin/stdout üzerinden satır satır JSON ile konuşur. Yani
native modül (robotjs / nut-js) derdi yok; giriş simülasyonunu Python tarafı yapar.

---

## 1. Kurulum

**`BASLAT.bat` dosyasına çift tıkla. Tek yapman gereken bu.**

İlk açılışta eksik ne varsa kendisi kurar (Python, Node.js, klavye motoru, arayüz
paketleri), masaüstüne kısayol koyar ve uygulamayı açar. Sonraki açılışlarda hiçbir
şey kurmaz, doğrudan başlar.

> Python ya da Node yeni kurulduysa Windows'un yol ayarları o pencerede eski kalır.
> Betik "pencereyi kapat, tekrar çalıştır" diyor — ikinci seferde sorunsuz devam eder.

### Klasörde ne var

| | |
|---|---|
| **BASLAT.bat** | Uygulamayı açar. Tek giriş noktası. |
| **EXE-OLUSTUR.bat** | Başkasına göndermek için tek dosyalık .exe üretir (aşağıda). |
| **KULLANIM.md** | Bu dosya. |
| `uygulama/` | Programın kendisi. Elle bir şey yapmana gerek yok. |
| `uygulama/araclar/` | Sorun çıkarsa: `motor_testi.bat` teşhis eder, `python_kur.bat` sadece Python kurar. |

## 2. Kullanım

İlk açılışta önce **dil** sorulur (bilgisayarının diline göre bir seçim önerilir),
sonra kısa bir **tanıtım turu** çalışır. Tur bir daha kendiliğinden açılmaz;
Ayarlar → Dil bölümünden tekrar başlatabilirsin.

Ekran üç parça: solda **adım listesi**, sağda **seçili adımın sayfası**, altta
**çalıştırma çubuğu**. Aradaki çizgiyi sürükleyerek sol paneli genişletebilirsin.

### Adımlar

Sol alttaki **+ Adım ekle** menüsü üç kategoriye ayrılmıştır:

| Kategori | Adımlar |
|---|---|
| 🖱 **Fare** | Tık · Çift tık · Sağ tık · Orta tık · Fareyi taşı · Tıkla ve taşı · Kaydır |
| ⌨ **Klavye** | Tuş · Metin · Piyano · Kombinasyon |
| ⏱ **Ekstra** | Bekle |

Listede her adım iki satır gösterir: üstte **aksiyon adı**, altta özeti
(“X:500 Y:300 × 1” gibi). Soldaki renkli nokta kategoriyi belirtir.

- **Sürükle-bırak:** adımı tutup istediğin yere bırak; bırakılacak konum ince bir
  çizgiyle gösterilir, numaralar otomatik yeniden hesaplanır.
- **✕ ile sil:** adımın üzerine gelince çıkar. Silince altta “geri al” çıkar.
- **▶ ile dene:** sadece o adımı bir kez çalıştırır.
- Adım sayfasının üstünde ayrıca ↑ ↓ (taşı), ⧉ (çoğalt), ◉ (devre dışı bırak) var.

### Kayıt (record)

Sol alttaki **⏺ Kaydet** düğmesi yaptığın hareketleri adıma çevirir. Tıklamalar
koordinatlarıyla, tuşlar, tekerlek ve isteğe bağlı olarak fare hareketi kaydedilir;
aralardaki beklemeler de **Bekle** adımı olarak eklenir.

3 saniyelik geri sayımdan sonra kayıt başlar — o sırada hedef uygulamaya geç.
Durdurmak için **F10**. Kaydedilenler mevcut adımların sonuna eklenir; istersen
"mevcut adımların yerine geçsin" seçeneğini işaretle.

Yani iki farklı koordinata ardı ardına tıklamak için tek tek adım eklemene gerek yok:
kaydı başlat, tıkla, F10.

### Alt çubuk

BAŞLAT / DURDUR'un yanında en sık kullanılan üç ayar doğrudan duruyor:
**tekrar**, **gecikme** (sn) ve **arası** (ms). Tekrarın yanındaki **∞** düğmesi
sonsuz moda alır — basılı hâldeyken makro sen durdurana kadar döner, tekrar
basınca eski sayıya geri döner. Sağdaki **⋯** diğer ayarları açar.

### Global kısayollar

Ayarlar → Kısayollar'da istediğin kadar kısayol tanımlayabilirsin. Her birinin
kendi tetikleyicisi, davranışı ve hedef makrosu vardır; tek tek açılıp kapatılabilir.

**Tetikleyici:** klavye tuşu (F1–F12 tek başına; harfler Ctrl/Alt ile) ya da
**fare düğmesi** — orta tık, yan düğmeler (4 ve 5). Sol ve sağ tık bilerek engellendi,
kısayol yapılırsa uygulama kullanılamaz hale gelir.

**Davranışlar:**

| Mod | Ne yapar |
|---|---|
| **Profil ayarına göre çalıştır** | Profilin kendi tekrar sayısını kullanır (eski F6 davranışı) |
| **Bir kez çalıştır** | Adımları baştan sona bir tur çalıştırır |
| **Aç / kapa** | İlk basışta sonsuz başlar, ikinci basışta durur |
| **Basılı tuttukça çalışsın** | Tuş/düğme bırakılınca anında durur |
| **Durdur** | Sadece çalışanı durdurur |
| **Sıraya ekle** | Makro çalışıyorsa bitince bir tur daha çalışır |

**Hedef makro:** "Seçili profil" ya da belirli bir profil. Yani bir kısayol her zaman
"Piyano" profilini, başka biri "Otomatik tık" profilini çalıştırabilir — o an hangisi
açık olduğu fark etmez.

### Uygulama içi kısayollar

| Tuş | İş |
|---|---|
| `F6` / `F8` | Makroyu başlat / durdur (uygulama arka plandayken de çalışır) |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / yinele |
| `Ctrl+D` | Seçili adımı çoğalt |
| `Delete` | Seçili adımı sil |
| `Esc` | Açık pencereyi kapat |

### Basit / Gelişmiş mod

**Basit** modda her adımda tek bir hız kaydırıcısı olur, milisaniye kutuları
gizlenir ve karşılığı yanında yazar. **Gelişmiş** modda hepsi geri gelir;
oradaki değerlerin kaybolmaz.

### Piyano adımı — nota sayfası notasyonu

| Yazım | Anlamı |
|---|---|
| `[abc]` | Tuşlara **aynı anda** basılır (akor) |
| `abc` | Hızlı ard arda |
| `a b c` | Aralarında mola |
| `\|` | Mola. Yanına boşluk ekledikçe uzar |
| `BÜYÜK harf` | Siyah tuş — Shift otomatik |
| satır sonu | Daha uzun mola |

### Koordinat seçme

Tık / Tıkla ve taşı / Fareyi taşı adımlarında **Yakala** düğmesine bas, sonra
ekranda istediğin noktaya sol tıkla — X/Y otomatik dolar.

### Ayarlar (sağ üstteki ⚙)

- **Kısayollar** — aşağıya bak
- **Çalıştırma** — aynı ayarların büyük hâli, ayrıca **hedef pencere**: açık pencereler
  listeden seçilir (⟳ ile tazelenir), listede yoksa adının bir parçasını yazabilir ya da
  "Aktif pencereyi yakala" ile alabilirsin. Makro başlarken o pencere öne getirilir,
  böylece ilk tık pencereyi aktifleştirmekle harcanmaz. Her profil kendi penceresini tutar.
- **Görünüm** — koyu/açık tema, 5 vurgu rengi, **zaman birimi (ms / saniye)**, yazı boyutu, kompakt mod
- **Dil** — Türkçe / English, ve turu tekrar gösterme
- **Motor ve tanılama** — motor sürümü, yeniden başlatma, günlük

Profiller üstteki listeden yönetilir: yeni, yeniden adlandır, kopyala, sil,
dosyaya kaydet, dosyadan aç. Her profil kendi çalıştırma ayarlarını taşır ve
her şey otomatik kaydedilir.

## 3. Başkasına gönderilecek .exe

**`EXE-OLUSTUR.bat` dosyasına çift tıkla.** Sonunda `uygulama\dist` klasöründe iki
dosya oluşur:

- **`MacroPad-Tasinabilir-1.0.0.exe`** — tek dosya, kurulum bile gerekmiyor.
  **Arkadaşına gönderilecek dosya budur.**
- `MacroPad-Kurulum-1.0.0.exe` — klasik kurulum sihirbazı isteyenler için.

Bu exe'lerin içinde Python motoru da, Electron da gömülü. **Karşı bilgisayarda
Python, Node.js ya da başka hiçbir şey kurulu olmasına gerek yok** — indirip çift
tıklamak yeterli. Yani arkadaşına asla `BASLAT.bat` ya da kaynak klasörü gönderme;
o senin geliştirme kurulumun.

Derleme sırasında bir şey ters giderse betik `derleme.log` dosyasını açar ve hangi
adımda takıldığını söyler.

> **Python 3.14 uyarısı:** PyInstaller en yeni Python sürümlerini genelde bir süre
> desteklemez. Betik bunu bildiği için sırayla 3.12 → 3.13 → 3.11 → 3.14 deniyor ve
> ilk çalışanı kullanıyor. Hiçbiri olmazsa Python 3.12 kurmanı söylüyor; eski sürümü
> silmene gerek yok, yan yana dururlar.

## 4. Sık karşılaşılan durumlar

**"Python bulunamadı" hatası (en sık karşılaşılan)**
Windows'ta `python` komutu çoğu makinede gerçek Python'a değil, **Microsoft Store
kısayoluna** gider ve hiçbir şey çalıştırmadan çıkar. İki ihtimal var:

1. Python gerçekten kurulu değil → https://www.python.org/downloads/ adresinden kur,
   kurulum ekranındaki **"Add python.exe to PATH"** kutusunu işaretlemeyi unutma.
2. Kurulu ama Store kısayolu araya giriyor → Başlat menüsünde
   **"Uygulama yürütme diğer adları"** (App execution aliases) ara, listedeki
   **python.exe** ve **python3.exe** anahtarlarını **kapat**.

Kontrol için komut isteminde `py -3 --version` yaz. Sürüm numarası yazıyorsa her şey yolunda —
`.bat` dosyaları zaten önce `py -3`'ü dener.

**"Motor yok" yazıyor / kırmızı nokta**
Python bulundu ama `pynput` kurulu değil. `py -3 -m pip install pynput` komutunu çalıştır.

**Tıklama doğru yere gidiyor ama işlemiyor**
Ayarlar → Motor'da **Yetenek** satırına bak: `sendinput` yazıyorsa fare olayları
Windows'un gerçek girdi kanalından gönderiliyor demektir. Yazmıyorsa yedek yol
devrede; yine de çalışması gerekir ama bazı uygulamalar bunu görmez.
Hedef uygulama yönetici yetkisiyle açıldıysa MacroPad'i de yönetici olarak çalıştır.
Ayarlar → Çalıştırma'daki **hedef pencere** özelliğini kullanmak da ilk tıkın
pencereyi aktifleştirmekle harcanmasını önler.

**Bazı programlarda tuşlar / tıklamalar işlemiyor**
Yönetici yetkisiyle açılmış programlar, düşük yetkili uygulamalardan giriş kabul
etmez. MacroPad'i de **sağ tık → Yönetici olarak çalıştır** ile aç.

**Oyunda çalışmıyor**
Birçok oyun DirectInput/RawInput dinler ve normal giriş simülasyonunu görmez.
Bu durumda scancode tabanlı (`SendInput`) bir sürüm gerekir — söyle, motoru ona göre değiştirelim.

**Antivirüs uyarısı**
Klavye/fare simüle eden ve PyInstaller ile paketlenen uygulamalar bazen işaretlenir; beklenen bir durum.

**Türkçe karakterler eksik yazılıyor**
Hedef uygulamanın klavye düzenine bağlıdır. Tuş gecikmesini 30–50 ms'ye çıkarmak çoğu durumda çözer.
