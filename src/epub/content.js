// Menyiapkan isi satu bab EPUB agar aman & siap ditampilkan:
// - aset (gambar, CSS, font) diganti blob URL
// - script / handler event dibuang
// - selector `html`/`body` di CSS buku diarahkan ke wadah `.epub-body`
import { dirname, resolvePath } from './parser.js';

const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea',
  'select', 'base', 'meta', 'link', 'noscript', 'title',
]);
const EXTERNAL = /^(data:|blob:|https?:|mailto:|tel:|#)/i;
const URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const FONT_FACE = /@font-face\s*{[^}]*}/gi;

function parseChapter(raw) {
  let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) {
    doc = new DOMParser().parseFromString(raw, 'text/html'); // XHTML rusak: pakai parser HTML yang toleran
  }
  return doc;
}

async function rewriteCss(book, css, cssDir, fontFaces) {
  const urls = new Map();
  for (const match of css.matchAll(URL_IN_CSS)) {
    const ref = match[2].trim();
    if (!EXTERNAL.test(ref) && !urls.has(ref)) urls.set(ref, await book.url(resolvePath(cssDir, ref)));
  }
  css = css.replace(URL_IN_CSS, (all, quote, ref) => (urls.get(ref.trim()) ? `url("${urls.get(ref.trim())}")` : all));
  css = css.replace(/@import[^;]+;/gi, '');
  // @font-face tidak berlaku di dalam Shadow DOM: dipindah ke dokumen utama
  css = css.replace(FONT_FACE, (rule) => {
    fontFaces.add(rule);
    return '';
  });
  return css.replace(/(^|[\s,}>+~(])(html|body)(?=[\s,{.#:[>+~)])/gi, '$1.epub-body');
}

function sanitize(root) {
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (BLOCKED_TAGS.has(el.localName)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const isLink = name === 'href' || name === 'src' || name.endsWith(':href') || name === 'action';
      if (name.startsWith('on') || (isLink && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
}

async function rewriteResources(book, body, dir) {
  const swap = async (el, attr) => {
    const value = el.getAttribute(attr);
    if (value && !EXTERNAL.test(value)) el.setAttribute(attr, await book.url(resolvePath(dir, value)));
  };
  for (const el of body.querySelectorAll('img, source, video, audio, track')) {
    await swap(el, 'src');
    if (el.hasAttribute('poster')) await swap(el, 'poster');
    el.removeAttribute('srcset');
  }
  for (const el of body.getElementsByTagNameNS('*', 'image')) {
    if (el.hasAttribute('href')) await swap(el, 'href');
    if (el.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
      const value = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!EXTERNAL.test(value)) {
        el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', await book.url(resolvePath(dir, value)));
      }
    }
  }
  for (const a of body.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else if (!href.startsWith('#')) {
      a.setAttribute('data-chapter', resolvePath(dir, href)); // tautan antar-bab
      a.removeAttribute('href');
    }
  }
}

function readViewport(doc) {
  const meta = Array.from(doc.getElementsByTagName('meta')).find((m) => m.getAttribute('name') === 'viewport');
  const content = meta?.getAttribute('content') || '';
  const w = Number(/width\s*=\s*(\d+)/.exec(content)?.[1]);
  const h = Number(/height\s*=\s*(\d+)/.exec(content)?.[1]);
  return w && h ? { w, h } : null;
}

/** Muat satu item spine. Return { path, html, css, bodyClass, viewport }. */
export async function loadChapter(book, item, fontFaces) {
  const doc = parseChapter(await book.text(item.path));
  const dir = dirname(item.path);
  const viewport = readViewport(doc);

  const cssParts = [];
  for (const el of Array.from(doc.querySelectorAll('link, style'))) {
    if (el.localName === 'link') {
      const href = el.getAttribute('href');
      if (/stylesheet/i.test(el.getAttribute('rel') || '') && href && !EXTERNAL.test(href)) {
        const cssPath = resolvePath(dir, href);
        try {
          cssParts.push(await rewriteCss(book, await book.text(cssPath), dirname(cssPath), fontFaces));
        } catch {
          /* CSS hilang: lewati */
        }
      }
    } else {
      cssParts.push(await rewriteCss(book, el.textContent, dir, fontFaces));
    }
    el.remove();
  }

  const body = doc.querySelector('body') || doc.documentElement;
  sanitize(body);
  await rewriteResources(book, body, dir);

  // Salin ke dokumen HTML agar diserialisasi sebagai HTML (bukan XML: <p/> dsb.)
  const htmlDoc = document.implementation.createHTMLDocument('');
  const wrapper = htmlDoc.createElement('div');
  for (const node of Array.from(body.childNodes)) wrapper.appendChild(htmlDoc.importNode(node, true));

  return {
    path: item.path,
    html: wrapper.innerHTML,
    css: cssParts.join('\n'),
    bodyClass: body.getAttribute?.('class') || '',
    viewport,
  };
}
