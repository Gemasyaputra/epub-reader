// Rak buku: daftar buku tersimpan, tambah (pilih / seret file), hapus.
import { addBook, deleteBook, listBooks, requestPersistence } from '../storage.js';
import { EpubBook } from '../epub/parser.js';
import { isPdfFile, openPdf } from '../pdf/pdf-book.js';
import { installAvailable, promptInstall, pwaEvents } from '../pwa.js';
import { ICONS, esc } from './dom.js';
import { toast } from './toast.js';

const COVER_COLORS = ['#8a4f2a', '#2f5d62', '#6b4e8a', '#9a3b3b', '#3f6b3a', '#a0672b', '#35507a'];

const newId = () =>
  crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function makeThumbnail(blob) {
  if (!blob) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 400 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return (await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))) || blob;
  } catch {
    return blob; // format yang tidak bisa diperkecil (mis. SVG): simpan apa adanya
  }
}

const isEpubFile = (f) => /\.epub$/i.test(f.name) || f.type === 'application/epub+zip';

/** Baca judul, penulis & sampul dari file EPUB atau PDF. */
async function readBookInfo(file) {
  if (isPdfFile(file)) {
    const pdf = await openPdf(file, { fileName: file.name });
    try {
      return { format: 'pdf', title: pdf.title, author: pdf.author, fixedLayout: true, cover: await pdf.thumbnail().catch(() => null) };
    } finally {
      pdf.close();
    }
  }
  const book = await EpubBook.open(file);
  const cover = book.coverPath ? await makeThumbnail(await book.blob(book.coverPath)) : null;
  book.close();
  return { format: 'epub', title: book.title, author: book.author, fixedLayout: book.fixedLayout, cover };
}

/** Tambahkan file-file EPUB/PDF ke rak. Return jumlah buku yang berhasil ditambahkan. */
export async function importFiles(files) {
  const books = [...files].filter((f) => isEpubFile(f) || isPdfFile(f));
  if (!books.length) {
    toast('Pilih file berformat .epub atau .pdf.');
    return 0;
  }
  let added = 0;
  for (const file of books) {
    try {
      const info = await readBookInfo(file);
      await addBook({
        id: newId(),
        ...info,
        fileName: file.name,
        size: file.size,
        addedAt: Date.now(),
        lastOpened: 0,
        progress: 0,
        position: null,
      }, file);
      added++;
    } catch (err) {
      toast(`Gagal membuka ${file.name}: ${err.message}.`, { duration: 6000 });
    }
  }
  if (added) {
    requestPersistence();
    toast(added === 1 ? 'Buku ditambahkan ke rak.' : `${added} buku ditambahkan ke rak.`);
  }
  return added;
}

function coverColor(title) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

const fileInput = (extraClass = '') =>
  `<input type="file" class="file-input ${extraClass}" accept=".epub,application/epub+zip,.pdf,application/pdf" multiple hidden>`;

export async function renderLibrary(app) {
  const coverUrls = [];
  app.innerHTML = `
    <div class="library">
      <header class="lib-header">
        <div class="brand">${ICONS.logo}<span>Lembar</span></div>
        <div class="lib-actions">
          <button type="button" class="btn btn-ghost" id="install-btn" hidden>${ICONS.download}<span>Install</span></button>
          <label class="btn btn-primary">${ICONS.plus}<span>Tambah buku</span>${fileInput()}</label>
        </div>
      </header>
      <main class="lib-main">
        <h1 class="lib-title">Rak buku</h1>
        <div id="shelf" aria-live="polite"></div>
      </main>
      <div class="drop-overlay" id="drop-overlay" hidden><div>Lepaskan file EPUB atau PDF di sini</div></div>
    </div>`;

  const shelf = app.querySelector('#shelf');
  const installBtn = app.querySelector('#install-btn');
  const dropOverlay = app.querySelector('#drop-overlay');

  const card = (book) => {
    const pct = Math.round(book.progress || 0);
    let cover;
    if (book.cover) {
      const url = URL.createObjectURL(book.cover);
      coverUrls.push(url);
      cover = `<img src="${url}" alt="" loading="lazy" decoding="async">`;
    } else {
      cover = `<div class="cover-placeholder" style="--cover:${coverColor(book.title)}"><span>${esc(book.title)}</span></div>`;
    }
    const status = book.lastOpened ? (pct >= 100 ? 'Selesai dibaca' : `${pct}% dibaca`) : 'Belum dibaca';
    return `
      <li class="book-card">
        <a class="book-link" href="#/read/${encodeURIComponent(book.id)}">
          <div class="cover">${cover}</div>
          <div class="book-info">
            <div class="book-title">${esc(book.title)}</div>
            <div class="book-author">${esc(book.author || 'Penulis tidak diketahui')}</div>
            <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
            <div class="book-meta">${status}${book.music ? ' · <span title="Ada musik pengiring">♪ musik</span>' : ''}</div>
          </div>
        </a>
        <button type="button" class="book-delete" data-id="${esc(book.id)}" aria-label="Hapus ${esc(book.title)}" title="Hapus dari rak">${ICONS.trash}</button>
      </li>`;
  };

  async function draw() {
    coverUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    const books = await listBooks();
    shelf.innerHTML = books.length
      ? `<ul class="shelf">${books.map(card).join('')}</ul>`
      : `<div class="empty">
          <div class="empty-art">${ICONS.bookOpen}</div>
          <h2>Rak bukumu masih kosong</h2>
          <p>Tambahkan file EPUB atau PDF dari perangkat ini. Buku disimpan di browser dan tetap bisa dibaca tanpa internet.</p>
          <label class="btn btn-primary">Pilih file EPUB / PDF${fileInput()}</label>
          <p class="hint">atau seret file ke halaman ini</p>
        </div>`;
  }

  const syncInstall = () => (installBtn.hidden = !installAvailable());

  const onChange = async (e) => {
    if (!e.target.classList.contains('file-input') || !e.target.files.length) return;
    const files = [...e.target.files];
    e.target.value = '';
    if (await importFiles(files)) draw();
  };

  let armed = null;
  const onClick = async (e) => {
    const del = e.target.closest('.book-delete');
    if (!del) return;
    e.preventDefault();
    if (armed !== del) {
      // klik pertama: minta konfirmasi tanpa dialog bawaan browser
      armed?.classList.remove('confirm');
      armed = del;
      del.classList.add('confirm');
      del.title = 'Klik lagi untuk menghapus';
      setTimeout(() => {
        if (armed === del) {
          del.classList.remove('confirm');
          armed = null;
        }
      }, 3000);
      return;
    }
    armed = null;
    await deleteBook(del.dataset.id);
    toast('Buku dihapus dari rak.');
    draw();
  };

  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.hidden = false;
  };
  const onDragOver = (e) => hasFiles(e) && e.preventDefault();
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  };
  const onDrop = async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (await importFiles(e.dataTransfer.files)) draw();
  };

  installBtn.addEventListener('click', promptInstall);
  app.addEventListener('change', onChange);
  app.addEventListener('click', onClick);
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
  pwaEvents.addEventListener('change', syncInstall);
  syncInstall();
  await draw();

  return () => {
    app.removeEventListener('change', onChange);
    app.removeEventListener('click', onClick);
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
    pwaEvents.removeEventListener('change', syncInstall);
    coverUrls.forEach((url) => URL.revokeObjectURL(url));
  };
}
