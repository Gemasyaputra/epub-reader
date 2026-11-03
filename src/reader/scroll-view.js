// Mode gulir: semua bab disusun memanjang ke bawah dan dibaca dengan scroll biasa.
// Antarmukanya sama dengan BookView (build, state, anchor, goTo..., next, prev, destroy).
// Bab hanya diisi saat mendekati layar, dan posisi baca dijaga agar teks tidak melompat
// ketika bab di atasnya selesai dimuat.
import { baseCss, escapeAttr, handleChapterLinks, settle, textCss } from './chapter-css.js';

const RENDER_MARGIN = '1500px 0px'; // bab mulai diisi saat jaraknya < 1500 px dari layar
const KEEP_CHAPTERS = 3; // bab lebih jauh dari ini dikosongkan (diganti tinggi terukurnya)
const FXL_MAX_WIDTH = 900;

function scrollCss(settings) {
  return `
.epub-body {
  box-sizing: border-box !important; margin: 0 !important; padding: 0 !important;
  width: auto !important; height: auto !important; max-width: none !important;
  columns: auto !important;
}
${textCss(settings, '80vh')}`;
}

export class ScrollView {
  constructor({ stage, fixedLayout, chapters, settings, onChange }) {
    this.stage = stage;
    this.fixedLayout = fixedLayout;
    this.chapters = chapters;
    this.settings = settings;
    this.onChange = onChange;
    this.anchor = null; // {chapter, frac}, format sama dengan mode buku
    this.anchorPx = 0; // jarak dari awal bab ke tepi atas layar (px)
    this.expectedTop = null; // scrollTop terakhir yang diatur oleh kode (bukan pengguna)
    this.rendered = new Set();
  }

  async build(position) {
    this.destroy();
    const scroller = document.createElement('div');
    scroller.className = 'scroll-view';
    scroller.tabIndex = -1; // bisa difokus: tombol panah atas/bawah menggulir
    const column = document.createElement('div');
    column.className = `scroll-column${this.fixedLayout ? ' scroll-column--fxl' : ''}`;
    scroller.append(column);
    this.stage.append(scroller);
    this.scroller = scroller;

    const width = column.clientWidth - (parseFloat(getComputedStyle(column).paddingLeft) * 2 || 0);
    this.width = Math.min(width, FXL_MAX_WIDTH);
    this.css = { base: baseCss(), text: scrollCss(this.settings) };
    this.sections = this.chapters.map((chapter, i) => {
      const section = document.createElement('section');
      section.className = 'scroll-chapter';
      section.dataset.index = String(i);
      section.style.height = `${this.estimateHeight(chapter)}px`;
      column.append(section);
      return section;
    });

    // isi bab saat mendekati layar
    this.io = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) this.render(Number(entry.target.dataset.index));
      this.unrenderFar();
    }, { root: scroller, rootMargin: RENDER_MARGIN });
    // tinggi bab berubah (baru diisi / gambar selesai dimuat) -> jaga posisi baca
    this.ro = new ResizeObserver(() => this.keepAnchor());
    for (const section of this.sections) {
      this.io.observe(section);
      this.ro.observe(section);
    }
    this.onScroll = () => {
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = null;
        // scroll yang kita sebabkan sendiri (setScrollTop) bukan gerakan pengguna: posisi
        // patokan jangan dihitung ulang, karena tata letak bisa sudah berubah (gambar termuat)
        if (this.expectedTop !== null && Math.abs(this.scroller.scrollTop - this.expectedTop) <= 2) return;
        this.expectedTop = null;
        this.updateAnchor();
      });
    };
    scroller.addEventListener('scroll', this.onScroll, { passive: true });

    const start = this.clampChapter(position?.chapter ?? 0);
    const near = [start - 1, start, start + 1].filter((i) => i >= 0 && i < this.sections.length);
    near.forEach((i) => this.render(i));
    // tunggu gambar di bab sekitar termuat dulu, agar posisi awal dihitung dari tinggi sebenarnya
    await Promise.all(near.map((i) => settle(this.sections[i].shadowRoot, 1500)));
    if (!this.scroller) return; // sudah dihancurkan selagi menunggu
    this.scrollToPosition({ chapter: start, frac: position?.frac || 0 });
    scroller.focus({ preventScroll: true });
    this.onChange?.(this.state());
  }

  clampChapter(i) {
    return Math.min(Math.max(i, 0), this.chapters.length - 1);
  }

  fixedHeight(chapter) {
    const vw = chapter.viewport?.w || 1000;
    const vh = chapter.viewport?.h || 1414;
    return Math.round(vh * (this.width / vw));
  }

  /** Perkiraan tinggi bab yang belum diisi (dari panjang teks & jumlah gambar). */
  estimateHeight(chapter) {
    if (this.fixedLayout) return this.fixedHeight(chapter);
    const fontPx = 16 * (this.settings.fontSize / 100);
    const text = chapter.html.replace(/<[^>]+>/g, '');
    const charsPerLine = Math.max(20, this.width / (fontPx * 0.5));
    const images = (chapter.html.match(/<img\b/gi) || []).length;
    return Math.round((text.length / charsPerLine) * fontPx * this.settings.lineHeight + images * 300 + 80);
  }

  render(i) {
    if (i < 0 || i >= this.sections.length || this.rendered.has(i)) return;
    this.rendered.add(i);
    const section = this.sections[i];
    let root = section.shadowRoot;
    if (!root) {
      root = section.attachShadow({ mode: 'open' });
      handleChapterLinks(root, (path) => this.goToPath(path));
    }
    const chapter = this.chapters[i];
    const cls = escapeAttr(chapter.bodyClass);
    if (this.fixedLayout) {
      const vw = chapter.viewport?.w || 1000;
      const vh = chapter.viewport?.h || 1414;
      root.innerHTML = `<style>:host { display: block; position: relative; overflow: hidden; }
.fxl-frame { position: absolute; left: 0; top: 0; width: ${vw}px; height: ${vh}px; transform: scale(${this.width / vw}); transform-origin: 0 0; }
.fxl-frame .epub-body { position: relative; margin: 0; width: ${vw}px; height: ${vh}px; }
${chapter.css}</style><div class="fxl-frame"><div class="epub-body ${cls}">${chapter.html}</div></div>`;
    } else {
      root.innerHTML = `<style>${this.css.base}${chapter.css}${this.css.text}</style>`
        + `<div class="epub-body ${cls}">${chapter.html}</div>`;
      section.style.height = ''; // tinggi mengikuti isi
    }
  }

  unrenderFar() {
    const current = this.anchor?.chapter ?? 0;
    for (const i of [...this.rendered]) {
      if (Math.abs(i - current) > KEEP_CHAPTERS) {
        const section = this.sections[i];
        section.style.height = `${section.offsetHeight}px`; // tahan tingginya agar scroll tidak loncat
        section.shadowRoot.innerHTML = '';
        this.rendered.delete(i);
      }
    }
  }

  /** Bab di tepi atas layar & seberapa jauh sudah dibaca. */
  updateAnchor() {
    const y = this.scroller.scrollTop + 1;
    let lo = 0;
    let hi = this.sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sections[mid].offsetTop <= y) lo = mid;
      else hi = mid - 1;
    }
    const section = this.sections[lo];
    this.anchorPx = Math.max(0, y - section.offsetTop);
    this.anchor = { chapter: lo, frac: Math.min(0.999, this.anchorPx / Math.max(1, section.offsetHeight)) };
    this.onChange?.(this.state());
  }

  keepAnchor() {
    if (!this.anchor || !this.scroller) return;
    const target = this.sections[this.anchor.chapter].offsetTop + this.anchorPx;
    if (Math.abs(this.scroller.scrollTop - target) > 1) this.setScrollTop(target);
  }

  setScrollTop(top) {
    this.expectedTop = Math.round(top);
    this.scroller.scrollTop = top;
  }

  scrollToPosition({ chapter, frac }) {
    const c = this.clampChapter(chapter);
    this.render(c);
    const section = this.sections[c];
    this.anchorPx = (frac || 0) * section.offsetHeight;
    this.anchor = { chapter: c, frac: frac || 0 };
    this.setScrollTop(section.offsetTop + this.anchorPx);
  }

  state() {
    const n = this.chapters.length;
    const anchor = this.anchor || { chapter: 0, frac: 0 };
    return {
      mode: 'scroll',
      index: anchor.chapter,
      total: n,
      chapter: anchor.chapter,
      frac: anchor.frac,
      anchor,
      percent: Math.min(1, (anchor.chapter + anchor.frac) / n),
    };
  }

  goToChapter(chapter) {
    this.scrollToPosition({ chapter, frac: 0 });
    this.onChange?.(this.state());
  }

  goToPath(path) {
    const chapter = this.chapters.findIndex((c) => c.path === path);
    if (chapter !== -1) this.goToChapter(chapter);
  }

  goToPercent(percent) {
    const x = Math.min(Math.max(percent, 0), 0.9999) * this.chapters.length;
    const chapter = Math.floor(x);
    this.scrollToPosition({ chapter, frac: x - chapter });
    this.onChange?.(this.state());
  }

  next() {
    this.scroller?.scrollBy({ top: this.scroller.clientHeight * 0.9, behavior: 'smooth' });
  }

  prev() {
    this.scroller?.scrollBy({ top: -this.scroller.clientHeight * 0.9, behavior: 'smooth' });
  }

  destroy() {
    this.io?.disconnect();
    this.ro?.disconnect();
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    this.scroller?.removeEventListener('scroll', this.onScroll);
    this.scroller?.remove();
    this.scroller = null;
    this.rendered.clear();
  }
}
