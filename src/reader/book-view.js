// Tampilan buku: memecah bab menjadi halaman (CSS multi-column) lalu menampilkannya
// dengan animasi lipatan kertas dari StPageFlip. Hanya halaman di sekitar posisi baca
// yang diisi konten, agar buku ratusan halaman tetap ringan.
import { PageFlip } from 'page-flip';
import { getLayout, saveLayout } from '../storage.js';
import { attachTouch } from './touch.js';

const GAP = 40; // jarak antar kolom (px), harus sama saat mengukur & menampilkan
const LAYOUT_VERSION = 1; // naikkan bila cara paginasi berubah (membuang cache lama)
const RENDER_NOW = 2; // halaman di sekitar posisi baca yang langsung diisi (dibutuhkan animasi)
const RENDER_BEHIND = 4; // sisanya disiapkan saat browser senggang
const RENDER_AHEAD = 6;
const KEEP_RENDERED = 14;

// Jalankan pekerjaan saat browser senggang (Safari belum punya requestIdleCallback)
const whenIdle = window.requestIdleCallback
  ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
  : (fn) => setTimeout(() => fn(null), 150);
const cancelIdle = window.cancelIdleCallback || clearTimeout;

export const FONT_STACKS = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/** Ukuran halaman & margin isi untuk area panggung tertentu. */
export function computeLayout(stageW, stageH, fixedRatio, spread = 'auto') {
  const landscape = spread === 'double' ? true
    : spread === 'single' ? false
    : stageW >= 760 && stageW > stageH * 1.1; // otomatis: 2 halaman bila layar lebar
  let pageW;
  let pageH;
  if (fixedRatio) {
    const maxW = landscape ? stageW / 2 : stageW;
    pageH = stageH;
    pageW = pageH * fixedRatio;
    if (pageW > maxW) {
      pageW = maxW;
      pageH = pageW / fixedRatio;
    }
  } else if (landscape) {
    pageH = stageH;
    pageW = Math.min(stageW / 2, pageH * 0.72);
  } else {
    pageW = Math.min(stageW, 680); // batasi panjang baris agar nyaman dibaca
    pageH = stageH;
  }
  pageW = Math.floor(pageW);
  pageH = Math.floor(pageH);
  const padX = Math.round(Math.min(56, Math.max(20, pageW * 0.08)));
  const padTop = Math.round(Math.min(48, Math.max(24, pageH * 0.05)));
  const padBottom = padTop + 16; // ruang nomor halaman
  return {
    landscape, pageW, pageH, padX, padTop, padBottom,
    innerW: pageW - padX * 2,
    innerH: pageH - padTop - padBottom,
  };
}

function baseCss(settings) {
  // Default sebelum CSS buku (boleh ditimpa buku)
  return `
:host { display: block; }
.epub-body { font-family: ${FONT_STACKS.serif}; }
.epub-body img { max-width: 100%; }
`;
}

function overrideCss(settings, L) {
  // Setelah CSS buku: wajib untuk paginasi + pengaturan pembaca
  const font = FONT_STACKS[settings.font];
  return `
.viewport { position: relative; width: ${L.innerW}px; height: ${L.innerH}px; overflow: hidden; }
.epub-body {
  box-sizing: border-box !important; margin: 0 !important; padding: 0 !important;
  width: ${L.innerW}px !important; height: ${L.innerH}px !important; max-width: none !important;
  column-width: ${L.innerW}px !important; column-gap: ${GAP}px !important;
  column-fill: auto !important; column-count: auto !important;
  font-size: ${settings.fontSize}% !important; line-height: ${settings.lineHeight} !important;
  color: var(--page-text); overflow-wrap: break-word; -webkit-hyphens: auto; hyphens: auto;
  ${font ? `font-family: ${font} !important;` : ''}
}
.epub-body p, .epub-body li, .epub-body blockquote, .epub-body dd, .epub-body div, .epub-body span {
  line-height: inherit !important; ${font ? 'font-family: inherit !important;' : ''}
}
.epub-body img, .epub-body svg, .epub-body video {
  max-width: 100% !important; max-height: ${L.innerH}px !important;
  height: auto; object-fit: contain; break-inside: avoid;
}
.epub-body figure { break-inside: avoid; margin-left: 0; margin-right: 0; }
.epub-body h1, .epub-body h2, .epub-body h3, .epub-body h4 { break-after: avoid; break-inside: avoid; line-height: 1.25 !important; }
.epub-body pre { white-space: pre-wrap; }
.epub-body table { max-width: 100%; }
.epub-body a { color: var(--page-link); }
${settings.theme === 'light' ? '' : `
.epub-body * { color: inherit !important; background-color: transparent !important; }
.epub-body a { color: var(--page-link) !important; }`}
`;
}

function chapterMarkup(css, chapter, shift = 0) {
  return `<style>${css.base}${chapter.css}${css.override}</style>`
    + `<div class="viewport"><div class="epub-body ${escapeAttr(chapter.bodyClass)}"`
    + ` style="transform: translateX(${-shift}px)">${chapter.html}</div></div>`;
}

function fixedMarkup(chapter, L) {
  const vw = chapter.viewport?.w || 1000;
  const vh = chapter.viewport?.h || 1414;
  const scale = Math.min(L.pageW / vw, L.pageH / vh);
  const left = (L.pageW - vw * scale) / 2;
  const top = (L.pageH - vh * scale) / 2;
  return `<style>:host { display: block; }
.fxl-frame { position: absolute; left: ${left}px; top: ${top}px; width: ${vw}px; height: ${vh}px;
  transform: scale(${scale}); transform-origin: 0 0; overflow: hidden; }
.fxl-frame .epub-body { position: relative; margin: 0; width: ${vw}px; height: ${vh}px; }
${chapter.css}</style>`
    + `<div class="fxl-frame"><div class="epub-body ${escapeAttr(chapter.bodyClass)}">${chapter.html}</div></div>`;
}

function escapeAttr(value) {
  return String(value).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function settle(root) {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  const loaded = Promise.all(pending.map((img) => new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  })));
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 4000))]);
  if (document.fonts?.ready) await document.fonts.ready;
}

/** Wadah tersembunyi untuk mengukur jumlah halaman tiap bab. */
class Measurer {
  constructor() {
    this.host = document.createElement('div');
    this.host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
    document.body.append(this.host);
    this.root = this.host.attachShadow({ mode: 'open' });
  }

  async count(chapter, css, L) {
    this.root.innerHTML = chapterMarkup(css, chapter);
    await settle(this.root);
    const body = this.root.querySelector('.epub-body');
    return Math.max(1, Math.round((body.scrollWidth + GAP) / (L.innerW + GAP)));
  }

  destroy() {
    this.host.remove();
  }
}

export class BookView {
  constructor({ stage, bookId, fixedLayout, chapters, settings, onChange }) {
    this.stage = stage;
    this.bookId = bookId;
    this.fixedLayout = fixedLayout;
    this.chapters = chapters;
    this.settings = settings;
    this.onChange = onChange;
    this.flip = null;
    this.rendered = new Set();
    // Posisi baca patokan ({chapter, frac}). Hanya berubah saat pengguna membalik/melompat
    // halaman, bukan saat tampilan disusun ulang, agar posisi tidak bergeser sedikit demi
    // sedikit setiap ganti ukuran huruf / layar / mode 1-2 halaman.
    this.anchor = null;
  }

  /** Susun halaman & tampilkan buku pada `position` ({chapter, frac}). */
  async build(position, onProgress) {
    this.destroyFlip();
    const rect = this.stage.getBoundingClientRect();
    const first = this.chapters[0].viewport;
    const ratio = this.fixedLayout ? (first ? first.w / first.h : 1 / Math.SQRT2) : null;
    const L = (this.layout = computeLayout(rect.width, rect.height, ratio, this.settings.spread));
    this.css = { base: baseCss(this.settings), override: overrideCss(this.settings, L) };

    this.counts = this.fixedLayout ? this.chapters.map(() => 1) : await this.measure(L, onProgress);
    this.starts = [];
    let total = 0;
    for (const count of this.counts) {
      this.starts.push(total);
      total += count;
    }
    this.total = total;

    const el = document.createElement('div');
    el.className = 'book';
    el.style.width = `${L.landscape ? L.pageW * 2 : L.pageW}px`;
    el.style.height = `${L.pageH}px`;
    el.style.setProperty('--pad-x', `${L.padX}px`);
    el.style.setProperty('--pad-top', `${L.padTop}px`);
    el.style.setProperty('--inner-w', `${L.innerW}px`);
    el.style.setProperty('--inner-h', `${L.innerH}px`);
    this.stage.append(el);
    this.el = el;

    this.pages = [];
    for (let i = 0; i < total; i++) {
      const page = document.createElement('div');
      page.className = ['page', this.fixedLayout && 'page--fxl', L.landscape && (i % 2 ? 'page--right' : 'page--left')]
        .filter(Boolean).join(' ');
      page.innerHTML = `<div class="page-content"></div>${this.fixedLayout ? '' : `<div class="page-number">${i + 1}</div>`}`;
      this.pages.push(page);
    }

    this.anchor = position || null;
    const start = this.indexFor(position);
    this.renderWindow(start);
    this.flip = new PageFlip(el, {
      width: L.pageW,
      height: L.pageH,
      size: 'fixed',
      autoSize: false,
      usePortrait: true,
      showCover: false,
      startPage: start,
      drawShadow: true,
      maxShadowOpacity: 0.5,
      flippingTime: 600,
      mobileScrollSupport: false,
      swipeDistance: 20,
      showPageCorners: true,
      clickEventForward: true,
      useMouseEvents: true,
    });
    this.flip.loadFromHTML(this.pages);
    this.detachTouch = attachTouch(this.stage, () => this.flip, L);
    this.flip.on('flip', (e) => {
      this.anchor = this.positionAt(e.data);
      this.renderWindow(e.data);
      this.onChange?.(this.state());
    });
    this.flip.on('changeState', (e) => {
      if (e.data === 'user_fold' || e.data === 'flipping') this.renderWindow(this.flip.getCurrentPageIndex());
    });
    this.onChange?.(this.state());
  }

  async measure(L, onProgress) {
    const s = this.settings;
    const key = [this.bookId, L.innerW, L.innerH, s.fontSize, s.font, s.lineHeight, LAYOUT_VERSION].join('|');
    const cached = await getLayout(key).catch(() => null);
    if (cached?.length === this.chapters.length) return cached;

    const measurer = new Measurer();
    const counts = [];
    try {
      for (const [i, chapter] of this.chapters.entries()) {
        counts.push(await measurer.count(chapter, this.css, L));
        onProgress?.((i + 1) / this.chapters.length);
      }
    } finally {
      measurer.destroy();
    }
    saveLayout(key, counts).catch(() => {});
    return counts;
  }

  chapterAt(index) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  indexFor(position) {
    if (!position) return 0;
    const c = Math.min(Math.max(position.chapter || 0, 0), this.counts.length - 1);
    const offset = Math.min(this.counts[c] - 1, Math.floor((position.frac || 0) * this.counts[c] + 1e-6));
    return this.starts[c] + Math.max(0, offset);
  }

  positionAt(index) {
    const chapter = this.chapterAt(index);
    return { chapter, frac: (index - this.starts[chapter]) / this.counts[chapter] };
  }

  state() {
    const index = this.flip ? this.flip.getCurrentPageIndex() : 0;
    const { chapter, frac } = this.positionAt(index);
    return {
      index,
      total: this.total,
      chapter,
      frac,
      anchor: this.anchor || { chapter, frac },
      percent: this.total > 1 ? index / (this.total - 1) : 1,
      landscape: this.layout.landscape,
    };
  }

  renderPage(i) {
    if (this.rendered.has(i)) return;
    this.rendered.add(i);
    const host = this.pages[i].querySelector('.page-content');
    let root = host.shadowRoot;
    if (!root) {
      root = host.attachShadow({ mode: 'open' });
      root.addEventListener('click', (e) => {
        const link = e.composedPath().find((n) => n.dataset?.chapter);
        if (link) this.goToPath(link.dataset.chapter); // tautan antar-bab di dalam buku
      });
    }
    const c = this.chapterAt(i);
    const chapter = this.chapters[c];
    root.innerHTML = this.fixedLayout
      ? fixedMarkup(chapter, this.layout)
      : chapterMarkup(this.css, chapter, (i - this.starts[c]) * (this.layout.innerW + GAP));
  }

  renderWindow(index) {
    // 1) halaman yang terlihat & yang akan terbuka saat dibalik: isi sekarang juga
    const clamp = (i) => Math.min(this.total - 1, Math.max(0, i));
    for (let i = clamp(index - RENDER_NOW); i <= clamp(index + RENDER_NOW + 1); i++) this.renderPage(i);

    // 2) sisanya satu per satu saat browser senggang, agar animasi berikutnya tidak tersendat
    // (yang langsung diisi: index-RENDER_NOW .. index+RENDER_NOW+1)
    const queue = [];
    for (let d = RENDER_NOW + 1; d <= Math.max(RENDER_AHEAD, RENDER_BEHIND); d++) {
      if (d >= RENDER_NOW + 2 && d <= RENDER_AHEAD && index + d < this.total) queue.push(index + d);
      if (d <= RENDER_BEHIND && index - d >= 0) queue.push(index - d);
    }
    cancelIdle(this.idleHandle);
    const step = (deadline) => {
      if (!this.flip) return;
      if (this.flip.getState() !== 'read') {
        this.idleHandle = whenIdle(step); // sedang membalik halaman: tunda
        return;
      }
      do {
        const i = queue.shift();
        if (i !== undefined) this.renderPage(i);
      } while (queue.length && deadline && deadline.timeRemaining() > 8);
      if (queue.length) this.idleHandle = whenIdle(step);
      else this.unrenderFar(index);
    };
    this.idleHandle = whenIdle(step);
  }

  unrenderFar(index) {
    for (const i of [...this.rendered]) {
      if (i < index - KEEP_RENDERED || i > index + KEEP_RENDERED) {
        this.pages[i].querySelector('.page-content').shadowRoot.innerHTML = '';
        this.rendered.delete(i);
      }
    }
  }

  goTo(index) {
    if (!this.flip) return;
    index = Math.min(Math.max(index, 0), this.total - 1);
    this.renderWindow(index);
    this.flip.turnToPage(index);
    this.anchor = this.positionAt(index);
    this.onChange?.(this.state());
  }

  goToChapter(chapter) {
    this.goTo(this.starts[chapter] ?? 0);
  }

  goToPath(path) {
    const chapter = this.chapters.findIndex((c) => c.path === path);
    if (chapter !== -1) this.goToChapter(chapter);
  }

  next() {
    this.flip?.flipNext();
  }

  prev() {
    this.flip?.flipPrev();
  }

  destroyFlip() {
    cancelIdle(this.idleHandle);
    this.detachTouch?.();
    this.detachTouch = null;
    if (this.flip) {
      this.flip.destroy(); // juga menghapus elemen buku
      this.flip = null;
    } else {
      this.el?.remove();
    }
    this.el = null;
    this.rendered.clear();
  }

  destroy() {
    this.destroyFlip();
  }
}
