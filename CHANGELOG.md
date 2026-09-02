# Değişiklik günlüğü

Sürüm numaraları uygulamanın kendisine, "motor" satırı ise arayüz ile Python
motoru arasındaki protokol sürümüne aittir.

## 1.0.0

İlk yayın.

### Arayüz
- Sol adım listesi + sağ düzenleyici düzeni, sürükle-bırak sıralama, tümünü silme
- Basit / Gelişmiş mod: basit modda adım başına tek hız kaydırıcısı
- Profiller: ayrı makro setleri, `.json` olarak kaydetme ve açma
- Kayıt: tıklama, tuş, tekerlek ve beklemeleri otomatik adıma çevirme
- Kategorili adım ekleme menüsü (Fare / Klavye / Ekstra)
- Türkçe ve İngilizce, işletim sistemi dilini algılama
- Açık/koyu tema, beş vurgu rengi, üç yazı boyutu, ms/saniye birimi
- İlk açılışta dil seçimi ve altı adımlık tanıtım turu
- Geri al / yinele, klavye kısayolları, alan doğrulama

### Kısayollar
- Sınırsız kısayol; tetikleyici olarak tuş ya da fare düğmesi (orta, yan düğmeler)
- Altı davranış: profil ayarına göre, bir kez, aç/kapa, basılı tuttukça, durdur, sıraya ekle
- Her kısayol belirli bir profili hedefleyebilir

### Motor (protokol 7)
- Klavye, fare, metin, piyano nota sayfası, kombinasyon, bekleme adımları
- Windows'ta `SendInput` ile gerçek hareket ve tıklama olayları
- Tuş/düğme basılı kalma süresi — çok kısa basışların yok sayılması sorunu giderildi
- Hareket kaydı, açık pencereleri listeleme ve pencereyi öne getirme
- Dinleyici bekçisi: kısayol dinleyicisi sessizce ölürse yeniden kurulur

### Paketleme
- `BASLAT.bat` — eksik ne varsa kurup uygulamayı açar
- `EXE-OLUSTUR.bat` — taşınabilir ve kurulumlu exe üretir, motoru derledikten sonra test eder
- GitHub Actions ile etiket atıldığında otomatik Windows derlemesi
