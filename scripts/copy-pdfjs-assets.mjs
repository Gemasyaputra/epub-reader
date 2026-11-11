// Salin aset pendukung pdf.js ke public/pdfjs/ (dijalankan otomatis sebelum dev & build).
// pdf.js memuat file-file ini lewat URL saat membuka PDF:
// - wasm/           decoder gambar JBIG2 & JPEG2000 (umum di PDF hasil scan) + profil warna
// - standard_fonts/ font standar PDF yang tidak tersemat di file
// - cmaps/          pemetaan karakter untuk font CJK/CID
// - iccs/           profil warna ICC
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');
const FOLDERS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
// QuickJS hanya untuk menjalankan JavaScript di dalam PDF — tidak dipakai (isEvalSupported: false)
const SKIP = /quickjs/i;

if (!existsSync(src)) {
  console.error('pdfjs-dist belum terpasang. Jalankan "npm install" dulu.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
for (const folder of FOLDERS) {
  const from = path.join(src, folder);
  if (existsSync(from)) {
    cpSync(from, path.join(dest, folder), { recursive: true, filter: (file) => !SKIP.test(path.basename(file)) });
  }
}
console.log(`Aset pdf.js disalin ke ${path.relative(root, dest)}/ (${FOLDERS.join(', ')})`);
