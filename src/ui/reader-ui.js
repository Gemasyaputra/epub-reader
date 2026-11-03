// Layar baca: toolbar, daftar isi, pengaturan tampilan, slider halaman.
import { getBook, getBookFile, loadSettings, saveSettings, updateBook } from '../storage.js';
import { EpubBook } from '../epub/parser.js';
import { loadChapter } from '../epub/content.js';
import { BookView } from '../reader/book-view.js';
import { ICONS, esc } from './dom.js';
import { setupMusic } from './music-ui.js';
import { toast } from './toast.js';

const LAYOUT_KEYS = ['fontSize', 'font', 'lineHeight'];
const FONT_SIZES = [80, 90, 100, 110, 120, 135, 150, 170];

const segmented = (key, options) =>
  `<div class="segmented" data-key="${key}">${options
    .map(([value, label]) => `<button type="button" data-value="${value}">${label}</button>`)
    .join('')}</div>`;

function template(meta, settings) {
  return `
  <div class="reader" data-theme="${esc(settings.theme)}">
    <header class="reader-bar reader-top">
      <a class="icon-btn" href="#/" aria-label="Kembali ke rak buku">${ICONS.back}</a>
      <div class="reader-titles">
        <div class="reader-book">${esc(meta.title)}</div>
        <div class="reader-chapter" id="chapter-title"></div>
      </div>
      <button type="button" class="icon-btn music-btn" id="music-btn" aria-label="Musik pengiring">${ICONS.music}</button>
      <button type="button" class="icon-btn" id="toc-btn" aria-label="Daftar isi">${ICONS.list}</button>
      <button type="button" class="icon-btn" id="settings-btn" aria-label="Pengaturan tampilan">${ICONS.type}</button>
    </header>

    <div class="stage-wrap">
      <button type="button" class="nav-zone nav-prev" id="prev-btn" aria-label="Halaman sebelumnya">${ICONS.chevronLeft}</button>
      <div class="stage" id="stage"></div>
      <button type="button" class="nav-zone nav-next" id="next-btn" aria-label="Halaman berikutnya">${ICONS.chevronRight}</button>
      <div class="loading" id="loading">
        <div class="spinner" aria-hidden="true"></div>
        <div id="loading-text">Membuka buku…</div>
        <div class="loading-bar"><span id="loading-fill"></span></div>
      </div>
    </div>

    <footer class="reader-bar reader-bottom">
      <input type="range" id="page-slider" min="1" max="1" value="1" aria-label="Pindah ke halaman">
      <div class="page-label" id="page-label">&nbsp;</div>
    </footer>

    <div class="scrim" id="scrim" hidden></div>

    <aside class="drawer" id="toc-panel" aria-label="Daftar isi" hidden>
      <div class="panel-head"><h2>Daftar isi</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${ICONS.close}</button></div>
      <ol class="toc-list" id="toc-list"></ol>
    </aside>

    <section class="sheet" id="settings-panel" aria-label="Pengaturan tampilan" hidden>
      <div class="panel-head"><h2>Tampilan</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${ICONS.close}</button></div>
      <div class="setting text-only">
        <span>Ukuran huruf</span>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="Perkecil huruf">A−</button>
          <output id="font-size-out">100%</output>
          <button type="button" data-step="1" aria-label="Perbesar huruf">A+</button>
        </div>
      </div>
      <div class="setting text-only"><span>Jenis huruf</span>${segmented('font', [['book', 'Bawaan'], ['serif', 'Serif'], ['sans', 'Sans']])}</div>
      <div class="setting text-only"><span>Jarak baris</span>${segmented('lineHeight', [['1.4', 'Rapat'], ['1.6', 'Normal'], ['1.9', 'Lega']])}</div>
      <div class="setting"><span>Tampilan halaman</span>${segmented('spread', [['auto', 'Otomatis'], ['single', '1 halaman'], ['double', '2 halaman']])}</div>
      <div class="setting"><span>Tema</span>${segmented('theme', [['light', 'Terang'], ['sepia', 'Sepia'], ['dark', 'Gelap']])}</div>
    </section>

    <section class="sheet" id="music-panel" aria-label="Musik pengiring" hidden></section>

    <div class="music-player collapsed" id="music-player" hidden>
      <div class="music-bar">
        <button type="button" class="music-toggle" id="music-toggle" aria-expanded="false">${ICONS.musicSmall}<span id="music-title">Musik</span></button>
        <button type="button" class="icon-btn music-close" id="music-close" aria-label="Hentikan musik">${ICONS.closeSmall}</button>
      </div>
      <div class="music-frame" id="music-frame"></div>
    </div>
  </div>`;
}

export async function openReader(app, id) {
  const meta = await getBook(id);
  if (!meta) {
    toast('Buku tidak ditemukan di rak.');
    location.hash = '#/';
    return () => {};
  }
  const settings = loadSettings();
  app.innerHTML = template(meta, settings);
  document.body.classList.add('reading');

  // semua pencarian elemen dibatasi pada reader ini (tetap aman bila user sudah pindah halaman)
  const root = app.querySelector('.reader');
  const $ = (sel) => root.querySelector(sel);
  const stage = $('#stage');
  const loading = $('#loading');
  const slider = $('#page-slider');
  const fontFaceStyle = document.createElement('style');
  document.head.append(fontFaceStyle);

  let book = null;
  let view = null;
  let disposed = false;
  let saveTimer = null;
  let lastState = null;
  const disposers = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };

  const setLoading = (text, fraction) => {
    loading.hidden = false;
    $('#loading-text').textContent = text;
    $('#loading-fill').style.width = `${Math.round((fraction || 0) * 100)}%`;
  };

  const cleanup = () => {
    disposed = true;
    clearTimeout(saveTimer);
    if (lastState) savePosition(lastState); // simpan posisi terakhir saat keluar
    disposers.forEach((fn) => fn());
    view?.destroy();
    book?.close();
    fontFaceStyle.remove();
    document.body.classList.remove('reading');
  };

  // ---- muat buku
  let chapters;
  let tocItems = [];
  try {
    const file = await getBookFile(id);
    if (!file) throw new Error('file buku tidak ditemukan');
    book = await EpubBook.open(file);
    const fontFaces = new Set();
    chapters = [];
    for (const [i, item] of book.spine.entries()) {
      if (disposed) return cleanup;
      chapters.push(await loadChapter(book, item, fontFaces));
      setLoading('Membuka buku…', ((i + 1) / book.spine.length) * 0.5);
    }
    fontFaceStyle.textContent = [...fontFaces].join('\n');
    tocItems = book.toc;
  } catch (err) {
    setLoading(`Buku tidak bisa dibuka: ${err.message}.`, 0);
    loading.classList.add('error');
    return cleanup;
  }
  if (disposed) return cleanup;

  if (book.fixedLayout) root.classList.add('fixed-layout');
  const chapterIndexByPath = new Map(chapters.map((c, i) => [c.path, i]));
  const chapterTitles = chapters.map((c) => tocItems.find((t) => t.path === c.path)?.title || '');
  for (let i = 1; i < chapterTitles.length; i++) chapterTitles[i] ||= chapterTitles[i - 1];

  // ---- posisi & tampilan
  function savePosition(state) {
    updateBook(id, {
      position: state.anchor,
      progress: Math.round(state.percent * 100),
      lastOpened: Date.now(),
    }).catch(() => {});
  }

  function onChange(state) {
    lastState = state;
    const { index, total, landscape, percent } = state;
    slider.max = String(total);
    slider.value = String(index + 1);
    const last = landscape ? Math.min(index + 2, total) : index + 1;
    const pages = last > index + 1 ? `${index + 1}–${last}` : `${index + 1}`;
    $('#page-label').textContent = `Halaman ${pages} dari ${total} · ${Math.round(percent * 100)}%`;
    $('#chapter-title').textContent = chapterTitles[state.chapter] || '';
    for (const el of root.querySelectorAll('.toc-list button')) {
      el.classList.toggle('current', Number(el.dataset.chapter) === state.chapter);
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePosition(state), 400);
  }

  view = new BookView({ stage, bookId: id, fixedLayout: book.fixedLayout, chapters, settings, onChange });

  let building = Promise.resolve();
  const rebuild = (message) => {
    building = building.then(async () => {
      if (disposed) return;
      const position = view.anchor || meta.position;
      setLoading(message, 0.5);
      await view.build(position, (p) => setLoading(message, 0.5 + p * 0.5));
      loading.hidden = true;
    }).catch((err) => {
      setLoading(`Gagal menyusun halaman: ${err.message}.`, 0);
      loading.classList.add('error');
    });
    return building;
  };

  // ---- daftar isi
  const tocList = $('#toc-list');
  const tocEntries = tocItems
    .map((t) => ({ ...t, chapter: chapterIndexByPath.get(t.path) }))
    .filter((t) => t.chapter !== undefined);
  tocList.innerHTML = tocEntries.length
    ? tocEntries.map((t) => `<li style="--level:${t.level}"><button type="button" data-chapter="${t.chapter}">${esc(t.title)}</button></li>`).join('')
    : '<li class="toc-empty">Buku ini tidak memiliki daftar isi.</li>';

  // ---- panel
  const scrim = $('#scrim');
  const panels = { toc: $('#toc-panel'), settings: $('#settings-panel'), music: $('#music-panel') };
  const openPanel = (name) => {
    Object.entries(panels).forEach(([key, el]) => (el.hidden = key !== name));
    scrim.hidden = false;
    if (name === 'toc') tocList.querySelector('.current')?.scrollIntoView({ block: 'center' });
  };
  const closePanels = () => {
    Object.values(panels).forEach((el) => (el.hidden = true));
    scrim.hidden = true;
  };

  const syncSettingsUI = () => {
    $('#font-size-out').textContent = `${settings.fontSize}%`;
    for (const group of root.querySelectorAll('.segmented')) {
      for (const btn of group.querySelectorAll('button')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.value === String(settings[group.dataset.key])));
      }
    }
  };

  const applySetting = (key, value) => {
    if (settings[key] === value) return;
    settings[key] = value;
    saveSettings(settings);
    syncSettingsUI();
    if (key === 'theme') {
      root.dataset.theme = value;
      // warna teks tema gelap/sepia dipasang lewat CSS halaman: susun ulang tanpa mengukur lagi
      rebuild('Mengganti tema…');
    } else if (key === 'spread') {
      rebuild('Mengatur tampilan halaman…'); // berlaku juga untuk buku fixed-layout
    } else if (LAYOUT_KEYS.includes(key) && !book.fixedLayout) {
      rebuild('Menyusun ulang halaman…');
    }
  };

  const music = setupMusic({ root, bookId: id, initialUrl: meta.music?.url, closePanels });
  disposers.push(() => music.dispose());
  listen($('#music-btn'), 'click', () => {
    music.renderPanel();
    openPanel('music');
    if (!meta.music && matchMedia('(hover: hover)').matches) music.focusInput(); // di HP jangan munculkan keyboard otomatis
  });
  listen($('#toc-btn'), 'click', () => openPanel('toc'));
  listen($('#settings-btn'), 'click', () => openPanel('settings'));
  listen(scrim, 'click', closePanels);
  listen(root, 'click', (e) => {
    if (e.target.closest('[data-close]')) closePanels();
    const tocBtn = e.target.closest('.toc-list button');
    if (tocBtn) {
      view.goToChapter(Number(tocBtn.dataset.chapter));
      closePanels();
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const i = FONT_SIZES.indexOf(settings.fontSize);
      const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, (i === -1 ? 2 : i) + Number(step.dataset.step)))];
      applySetting('fontSize', next);
    }
    const seg = e.target.closest('.segmented button');
    if (seg) {
      const key = seg.parentElement.dataset.key;
      applySetting(key, key === 'lineHeight' ? Number(seg.dataset.value) : seg.dataset.value);
    }
  });

  listen($('#prev-btn'), 'click', () => view.prev());
  listen($('#next-btn'), 'click', () => view.next());
  listen(slider, 'input', () => {
    $('#page-label').textContent = `Ke halaman ${slider.value} dari ${slider.max}`;
  });
  listen(slider, 'change', () => view.goTo(Number(slider.value) - 1));
  listen(window, 'keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') closePanels();
    else if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      view.next();
    } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      view.prev();
    }
  });

  // ukuran layar berubah (putar HP, resize jendela) -> susun ulang
  let size = null;
  let resizeTimer = null;
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!size) {
      size = { width, height };
      return;
    }
    // abaikan perubahan kecil (mis. address bar HP muncul/hilang)
    if (Math.abs(width - size.width) < 24 && Math.abs(height - size.height) < 90) return;
    size = { width, height };
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rebuild('Menyesuaikan ukuran layar…'), 250);
  });
  observer.observe(stage);
  disposers.push(() => observer.disconnect());

  syncSettingsUI();
  await rebuild('Menyusun halaman…');
  return cleanup;
}
