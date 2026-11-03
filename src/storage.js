// Penyimpanan lokal di browser (IndexedDB): buku, file EPUB, dan cache tata letak halaman.
// Semua akses lewat modul ini, sehingga nanti bisa diganti/ditambah sinkronisasi ke server.
import { openDB } from 'idb';

const dbPromise = openDB('lembar', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' }); // metadata + sampul (kecil)
    db.createObjectStore('files'); // file EPUB asli, key = id buku
    db.createObjectStore('layouts'); // jumlah halaman per bab, key = "id|ukuran|pengaturan"
  },
});

export async function listBooks() {
  const books = await (await dbPromise).getAll('books');
  return books.sort((a, b) => (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt));
}

export async function getBook(id) {
  return (await dbPromise).get('books', id);
}

export async function getBookFile(id) {
  return (await dbPromise).get('files', id);
}

export async function addBook(meta, file) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('files').put(file, meta.id),
    tx.done,
  ]);
}

export async function updateBook(id, patch) {
  const db = await dbPromise;
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...book, ...patch });
  await tx.done;
}

export async function deleteBook(id) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'files', 'layouts'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`);
  let cursor = await tx.objectStore('layouts').openCursor(range);
  while (cursor) {
    cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getLayout(key) {
  return (await dbPromise).get('layouts', key);
}

export async function saveLayout(key, value) {
  return (await dbPromise).put('layouts', value, key);
}

// Minta browser agar tidak menghapus data saat ruang penyimpanan menipis.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* tidak didukung: abaikan */
  }
}

// Pengaturan tampilan baca: kecil & per perangkat, cukup di localStorage.
const SETTINGS_KEY = 'lembar.settings';
// spread: 'auto' (2 halaman bila layar lebar), 'single' (selalu 1), 'double' (selalu 2)
export const DEFAULT_SETTINGS = { fontSize: 100, font: 'book', lineHeight: 1.6, theme: 'light', spread: 'auto' };

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* mode privat / storage diblokir */
  }
}
