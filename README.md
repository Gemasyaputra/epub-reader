# Lembar — Pembaca EPUB

Aplikasi web untuk membaca buku EPUB dengan **animasi membalik halaman** (lipatan kertas realistis), bisa di-install seperti aplikasi (PWA) dan dipakai **tanpa internet**.

## Fitur

- **Rak buku**: tambah file `.epub` (tombol atau seret file ke halaman), sampul otomatis, progres baca, hapus buku.
- **Membaca**: halaman melengkung saat di-drag dari sudut, klik/tap sisi halaman, swipe, tombol panah keyboard, atau slider.
  - Tampilan halaman bisa dipilih: **Otomatis** (2 halaman di layar lebar/landscape, 1 halaman di HP portrait), **1 halaman**, atau **2 halaman**.
  - Daftar isi, judul bab di toolbar, nomor halaman.
  - Pengaturan: ukuran huruf, jenis huruf (bawaan buku/serif/sans), jarak baris, tema terang/sepia/gelap.
  - Posisi baca disimpan otomatis dan tetap tepat walau ukuran huruf/layar berubah.
- **Musik pengiring per buku**: tempel link lagu/album/playlist **YouTube** atau **Spotify** lewat tombol ♪ saat membaca; diputar di pemutar mini yang tetap jalan saat halaman dibalik (bisa dikecilkan). Butuh internet; Spotify memutar lagu penuh bila sudah login Spotify di browser (tanpa login hanya cuplikan 30 detik).
- **EPUB fixed-layout** (mis. hasil "mode Gambar" dari konverter PDF→EPUB) tampil per halaman, pas dengan layar.
- **PWA**: tombol Install, offline penuh, notifikasi versi baru; di Chrome desktop file `.epub` bisa dibuka langsung dengan "Buka dengan Lembar".

Semua buku disimpan di **browser perangkat itu sendiri** (IndexedDB). Tidak ada server, login, atau database — buku tidak dikirim ke mana pun.

## Menjalankan di komputer

Butuh Node.js 18+.

```bash
npm install
npm run dev        # mode pengembangan: http://localhost:5173
npm run build      # hasil siap deploy di folder dist/
npm run preview    # coba hasil build (termasuk service worker): http://localhost:4173
```

> Service worker / mode offline hanya aktif pada hasil build (`npm run build` lalu `npm run preview`), bukan di `npm run dev`.

## Deploy ke Vercel

1. Upload folder ini ke GitHub (file `.gitignore` sudah mengecualikan `node_modules` dan `dist`).
2. Di [vercel.com](https://vercel.com) → **Add New… → Project** → pilih repo tersebut.
3. Pengaturan otomatis terbaca dari `vercel.json` (framework Vite, build `npm run build`, output `dist`). Klik **Deploy**.

Atau lewat CLI: `npx vercel` lalu `npx vercel --prod`.

Setelah online (HTTPS), buka di HP:
- **Android (Chrome)**: tombol **Install** di aplikasi, atau menu ⋮ → *Install app*.
- **iPhone/iPad (Safari)**: tombol Bagikan → *Tambahkan ke Layar Utama*.

## Struktur

```
src/
  main.js              router (#/ rak, #/read/<id> membaca)
  storage.js           IndexedDB: buku, file, cache tata letak; pengaturan di localStorage
  epub/parser.js       membaca container.xml, OPF, spine, sampul, daftar isi (nav/NCX)
  epub/content.js      menyiapkan isi bab: aset -> blob URL, buang script, CSS buku diisolasi
  reader/book-view.js  paginasi (CSS multi-column di Shadow DOM) + animasi StPageFlip
  ui/library.js        rak buku
  ui/reader-ui.js      layar baca, daftar isi, pengaturan
  pwa.js               service worker & tombol install
```

## Rencana lanjutan (opsional)

Untuk **sinkron progres/bookmark antar perangkat** perlu login + backend: metadata (progres, bookmark) cocok di **Neon (Postgres)**, sedangkan file EPUB lebih tepat di **Vercel Blob** atau penyimpanan objek lain. Semua akses data sudah dipusatkan di `src/storage.js`, jadi lapisan sinkron bisa ditambahkan di sana tanpa mengubah tampilan.

## Lisensi pihak ketiga

- [StPageFlip / page-flip](https://github.com/Nodlik/StPageFlip) — MIT
- [JSZip](https://stuk.github.io/jszip/) — MIT / GPLv3
- [idb](https://github.com/jakearchibald/idb) — ISC
