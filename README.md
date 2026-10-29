# AR Print Preview — PoC WebAR

Proof of Concept untuk menempatkan spanduk virtual **berskala fisik** pada dinding melalui kamera ponsel di browser, sesuai **Ketentuan PoC WebAR v1.3**.

- Teknologi: Svelte 5 + Vite + TypeScript, three.js, WebXR Device API (`immersive-ar` dengan `hit-test`, opsional `dom-overlay` dan `anchors`).
- Target uji utama: Samsung Galaxy S20 FE, Chrome Android, dengan Google Play Services for AR.
- Hanya frontend. Tidak ada backend, database, login, atau alur pemesanan.

## Menjalankan

Butuh Node.js 20 atau lebih baru.

```bash
npm install
npm run dev      # server pengembangan di http://localhost:5173
npm run check    # pemeriksaan tipe
npm run build    # hasil build di folder dist/
```

WebXR hanya berjalan pada **konteks aman** (HTTPS atau `localhost`). Ada dua cara membuka halaman di ponsel.

### Cara 1 — USB + port forwarding (untuk pengembangan)

Perubahan kode langsung terlihat, dan console ponsel bisa dilihat dari laptop.

1. Di ponsel, aktifkan **Opsi pengembang**: Pengaturan → Tentang ponsel → Informasi perangkat lunak → ketuk **Nomor versi** tujuh kali.
2. Di Opsi pengembang, aktifkan **Debugging USB**.
3. Hubungkan ponsel ke laptop dengan kabel USB, lalu izinkan debugging di ponsel.
4. Jalankan `npm run dev` di laptop.
5. Di Chrome laptop, buka `chrome://inspect/#devices` → **Port forwarding…** → tambahkan port `5173` ke `localhost:5173` → centang **Enable port forwarding** → **Done**.
6. Di Chrome ponsel, buka `http://localhost:5173`.
7. Untuk melihat console dan error, klik **inspect** pada tab ponsel di `chrome://inspect`.

### Cara 2 — GitHub Pages (untuk pengujian formal)

URL tetap, bisa dibuka tanpa laptop di lokasi dinding uji.

1. Buat repositori **publik** di GitHub, lalu push proyek ini ke branch `main`:
   ```bash
   git init
   git add .
   git commit -m "PoC WebAR AR Print Preview"
   git branch -M main
   git remote add origin https://github.com/<username>/<nama-repo>.git
   git push -u origin main
   ```
2. Di repositori: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Setiap push ke `main` menjalankan `.github/workflows/deploy.yml` (cek tipe, build, deploy).
4. Halaman tersedia di `https://<username>.github.io/<nama-repo>/`.

Base path diatur otomatis dari nama repositori melalui variabel `BASE_PATH`.

## Cara memakai

1. Pilih ukuran spanduk (preset atau isi lebar/tinggi; dimensi lain dihitung dari rasio desain).
2. Tekan **Mulai AR** dan izinkan kamera.
3. Mendekat ke dinding (sekitar 1–2 m). Arahkan lingkaran di tengah layar ke dinding dan gerakkan ponsel perlahan.
4. Warna penanda: **merah** = bidang tidak vertikal, **kuning** = dinding terdeteksi tetapi belum stabil, **hijau** = siap.
5. Saat hijau, ketuk layar. Spanduk ditempatkan dengan **titik tengahnya** di titik yang dibidik.
6. Mundur perlahan untuk meninjau seluruh spanduk. Ukuran bisa diganti lewat tombol ukuran di bawah.
7. **Reset** untuk memilih lokasi baru, **Akhiri AR** untuk menutup kamera.
8. Kembali di halaman awal, **Salin** atau **Unduh .json** log uji untuk laporan.

Tombol **Info uji** menampilkan sudut normal bidang, status vertikal, frame stabil, jarak ke bidang, jarak ke spanduk, ukuran, dan status anchor.

## Struktur

```
src/
  App.svelte               Halaman awal dan overlay AR
  app.css                  Gaya global
  assets/spanduk-uji.png   Aset spanduk uji orisinal (3000 × 1000 px, rasio 3:1)
  lib/
    config.ts              Parameter PoC yang dicatat di laporan
    SizeControl.svelte     Preset dan input satu dimensi, rasio terkunci
    ar/ArController.ts     Sesi WebXR, hit-test, filter orientasi, anchor, log
.github/workflows/deploy.yml  Deploy GitHub Pages
```

## Parameter yang dicatat (Ketentuan v1.3, bagian 15)

Semua ada di `src/lib/config.ts`. Jika diubah, catat nilai barunya di laporan pengujian.

| Parameter | Nilai awal | Arti |
|---|---|---|
| `VERTICAL_TOLERANCE_DEG` | 15° | Normal bidang maksimal 15° dari horizontal agar dianggap dinding vertikal |
| `STABLE_FRAMES` | 15 | Jumlah frame berturut-turut vertikal dan stabil sebelum penempatan diizinkan |
| `STABLE_MAX_ANGLE_CHANGE_DEG` | 4° | Perubahan arah normal maksimum antar-frame agar masih dihitung stabil |
| `PLACEMENT_WARN_DISTANCE_M` | 2,5 m | Jarak yang memicu peringatan "terlalu jauh"; penempatan tetap diizinkan agar batas jarak bisa diukur (T-18) |
| `WALL_OFFSET_M` | 3 mm | Jarak spanduk dari permukaan dinding agar tidak berkedip |
| `SIZE_PRESETS_CM` | 150, 200, 300, 400 (lebar) | **Asumsi**; ganti dengan ukuran yang umum dipesan menurut perusahaan |
| `DEFAULT_WIDTH_CM` | 300 | Ukuran acuan 300 × 100 cm untuk aset 3:1 |

## Aset spanduk uji

`src/assets/spanduk-uji.png` adalah desain orisinal untuk pengujian. Pada ukuran acuan 300 × 100 cm, 1 px = 1 mm:

- Grid tipis dan garis skala di keempat tepi setiap 10 cm, garis panjang setiap 50 cm (berlabel 50–250 cm).
- Tanda silang di titik tengah (titik penempatan).
- Bingkai tebal dan penanda sudut sebagai batas cetak.

Grid dan garis skala membantu uji skala (T-13, T-14) dan uji *drift* (T-09). Untuk mengganti desain, timpa file ini; rasio dibaca otomatis dari ukuran gambar. Preset harus disesuaikan agar rasionya sama.

## Pemetaan ke ketentuan

| Kebutuhan | Implementasi |
|---|---|
| F-01 Memulai sesi | `requestSession` dipanggil langsung dari klik **Mulai AR** |
| F-02 Kamera | Sesi `immersive-ar` menampilkan kamera |
| F-03 Instruksi | Pesan status per keadaan; indikasi siap hanya saat reticle vertikal dan stabil; peringatan jarak |
| F-04 Bidang terdeteksi | Penempatan hanya dari hasil hit-test; hasil tidak vertikal ditolak (filter orientasi) |
| F-05 Penambatan | Matriks dunia dari hit-test; diikat ke anchor bila fitur `anchors` didukung |
| F-06 Skala fisik | Bidang 1 × 1 m diskalakan ke ukuran dalam meter; rasio dari gambar |
| F-07 Pemilihan ukuran | Preset atau satu dimensi; dimensi lain dihitung otomatis |
| F-08 Penempatan ulang | Tombol **Reset** menghapus spanduk dan anchor |
| F-09 Mengakhiri sesi | Tombol **Akhiri AR** menutup sesi dan kamera |
| F-10 Kesalahan | Pemeriksaan konteks aman, WebXR, dukungan `immersive-ar`; pesan untuk izin ditolak dan kegagalan sesi |

Log uji (bisa diunduh sebagai JSON) mencatat: mulai/akhir sesi, parameter, fitur yang aktif, setiap penempatan beserta sudut, jarak, dan ukuran, penolakan penempatan beserta alasannya, anchor, perubahan ukuran, reset, serta pelacakan hilang/kembali. Data ini mendukung T-05, T-17, T-18, dan T-19.

## Keterbatasan yang sudah diketahui

- Hanya Chrome Android dengan ARCore. Safari iOS tidak mendukung WebXR `immersive-ar`.
- Spanduk tidak tertutup benda nyata di depannya (tanpa oklusi).
- Warna di layar tidak mewakili warna hasil cetak.
- Ukuran adalah perkiraan; ketepatannya diukur melalui protokol galat relatif pada ketentuan (bagian 9).
