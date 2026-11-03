// Membuka file PDF untuk dibaca di Lembar. Setiap halaman PDF menjadi satu "bab"
// fixed-layout yang digambar ke <canvas> hanya saat dibutuhkan, dengan resolusi
// sesuai ukuran tampil. pdf.js dimuat dinamis agar tidak memperberat aplikasi
// ketika pengguna hanya membaca EPUB.

const MAX_RENDER_WIDTH = 2000; // px, batas resolusi canvas per halaman (hemat memori HP)
const THUMB_WIDTH = 400;

let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

export const isPdfFile = (file) => /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf';

function pageChapter(pdf, number, width, height) {
  return {
    path: `page-${number}`,
    html: '<canvas class="pdf-page"></canvas>',
    css: '.pdf-page { display: block; width: 100%; height: 100%; background: #fff; }',
    bodyClass: '',
    viewport: { w: width, h: height },
    /** Gambar halaman ke `canvas` untuk lebar tampil `cssWidth` (px CSS). */
    async renderInto(canvas, cssWidth) {
      if (!canvas) return;
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const pixels = Math.min(MAX_RENDER_WIDTH, Math.ceil(cssWidth * (window.devicePixelRatio || 1)));
      const viewport = page.getViewport({ scale: pixels / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      try {
        await page.render({ canvas, viewport }).promise;
      } catch {
        /* dibatalkan / halaman sudah tidak ditampilkan */
      }
    },
  };
}

async function readOutline(pdf) {
  const toc = [];
  const pageIndexOf = async (dest) => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!explicit) return null;
      return typeof explicit[0] === 'number' ? explicit[0] : await pdf.getPageIndex(explicit[0]);
    } catch {
      return null;
    }
  };
  const walk = async (items, level) => {
    for (const item of items || []) {
      const index = await pageIndexOf(item.dest);
      if (index !== null && item.title?.trim()) toc.push({ title: item.title.trim(), path: `page-${index + 1}`, level });
      await walk(item.items, level + 1);
    }
  };
  await walk(await pdf.getOutline().catch(() => null), 0);
  return toc;
}

/**
 * Buka PDF. Return objek yang dipakai rak & pembaca:
 * { title, author, fixedLayout, chapters, toc, thumbnail(), close() }
 */
export async function openPdf(blob, { fileName = '', onProgress } = {}) {
  const pdfjs = await loadPdfJs();
  let pdf;
  let loadingTask;
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
    pdf = await loadingTask.promise;
  } catch (err) {
    loadingTask?.destroy();
    throw new Error(err?.name === 'PasswordException' ? 'PDF ini terkunci password' : 'file bukan PDF yang valid');
  }

  const info = (await pdf.getMetadata().catch(() => null))?.info || {};
  const title = String(info.Title || '').trim() || fileName.replace(/\.pdf$/i, '') || 'Dokumen PDF';
  const author = String(info.Author || '').trim();

  const chapters = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    chapters.push(pageChapter(pdf, n, Math.round(width), Math.round(height)));
    page.cleanup();
    onProgress?.(n / pdf.numPages);
  }

  return {
    format: 'pdf',
    title,
    author,
    fixedLayout: true,
    chapters,
    toc: await readOutline(pdf),
    async thumbnail() {
      const canvas = document.createElement('canvas');
      await chapters[0].renderInto(canvas, THUMB_WIDTH / (window.devicePixelRatio || 1));
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    },
    close() {
      loadingTask.destroy(); // pdf.js v6: dokumen ditutup lewat loading task
    },
  };
}
