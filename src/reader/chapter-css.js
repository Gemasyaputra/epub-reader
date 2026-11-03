// CSS & helper untuk menampilkan isi bab di dalam Shadow DOM.
// Dipakai bersama oleh mode buku (book-view.js) dan mode gulir (scroll-view.js).

export const FONT_STACKS = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/** Default sebelum CSS buku (boleh ditimpa buku). */
export function baseCss() {
  return `
:host { display: block; }
.epub-body { font-family: ${FONT_STACKS.serif}; }
.epub-body img { max-width: 100%; }
`;
}

/** Pengaturan pembaca (huruf, jarak baris, tema, gambar). Dipasang setelah CSS buku. */
export function textCss(settings, maxImageHeight) {
  const font = FONT_STACKS[settings.font];
  return `
.epub-body {
  font-size: ${settings.fontSize}% !important; line-height: ${settings.lineHeight} !important;
  color: var(--page-text); overflow-wrap: break-word; -webkit-hyphens: auto; hyphens: auto;
  ${font ? `font-family: ${font} !important;` : ''}
}
.epub-body p, .epub-body li, .epub-body blockquote, .epub-body dd, .epub-body div, .epub-body span {
  line-height: inherit !important; ${font ? 'font-family: inherit !important;' : ''}
}
.epub-body img, .epub-body svg, .epub-body video {
  max-width: 100% !important; max-height: ${maxImageHeight} !important;
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

export function escapeAttr(value) {
  return String(value).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** Tunggu gambar & font di `root` selesai dimuat (maks `timeout` ms). */
export async function settle(root, timeout = 4000) {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  const loaded = Promise.all(pending.map((img) => new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  })));
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, timeout))]);
  if (document.fonts?.ready) await document.fonts.ready;
}

/** Klik tautan antar-bab di dalam Shadow DOM -> panggil `goToPath`. */
export function handleChapterLinks(root, goToPath) {
  root.addEventListener('click', (e) => {
    const link = e.composedPath().find((n) => n.dataset?.chapter);
    if (link) goToPath(link.dataset.chapter);
  });
}
