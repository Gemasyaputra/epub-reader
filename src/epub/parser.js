// Membaca struktur EPUB: container.xml -> OPF (metadata, manifest, spine) -> daftar isi.
import JSZip from 'jszip';

const MIME_BY_EXT = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', mp4: 'video/mp4',
};
// Enkripsi yang hanya menyamarkan font (bukan DRM)
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

export function dirname(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Gabungkan path relatif `href` terhadap folder `base` (tanpa #fragment / ?query). */
export function resolvePath(base, href) {
  let path = href.split('#')[0].split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* biarkan apa adanya */
  }
  path = path.startsWith('/') ? path.slice(1) : (base ? `${base}/` : '') + path;
  const out = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

export function guessMime(path) {
  return MIME_BY_EXT[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('struktur XML rusak');
  return doc;
}

const byTag = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const childrenNamed = (node, name) => Array.from(node.children).filter((c) => c.localName === name);

export class EpubBook {
  static async open(blob) {
    let zip;
    try {
      zip = await JSZip.loadAsync(blob);
    } catch {
      throw new Error('file bukan EPUB yang valid');
    }
    const book = new EpubBook(zip);
    await book.load();
    return book;
  }

  constructor(zip) {
    this.zip = zip;
    this.urls = new Map();
    this.index = null;
  }

  entry(path) {
    if (!this.index) {
      this.index = new Map();
      this.zip.forEach((p, f) => !f.dir && this.index.set(p.toLowerCase(), f));
    }
    return this.zip.file(path) || this.index.get(path.toLowerCase()) || null;
  }

  async text(path) {
    const file = this.entry(path);
    if (!file) throw new Error(`file "${path}" tidak ada di dalam EPUB`);
    return file.async('string');
  }

  async blob(path, type) {
    const file = this.entry(path);
    if (!file) return null;
    const data = await file.async('arraybuffer');
    return new Blob([data], { type: type || this.byPath.get(path)?.mediaType || guessMime(path) });
  }

  /** Blob URL untuk aset di dalam EPUB (gambar, font, dll.), dibuat sekali lalu dipakai ulang. */
  async url(path) {
    if (!this.urls.has(path)) {
      const blob = await this.blob(path);
      this.urls.set(path, blob ? URL.createObjectURL(blob) : '');
    }
    return this.urls.get(path);
  }

  close() {
    for (const url of this.urls.values()) if (url) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  async load() {
    if (this.entry('META-INF/encryption.xml')) {
      const enc = parseXml(await this.text('META-INF/encryption.xml'));
      const algorithms = byTag(enc, 'EncryptionMethod').map((m) => m.getAttribute('Algorithm'));
      if (algorithms.some((a) => !FONT_OBFUSCATION.includes(a))) {
        throw new Error('buku ini dilindungi DRM');
      }
    }

    const container = parseXml(await this.text('META-INF/container.xml'));
    const opfPath = byTag(container, 'rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) throw new Error('EPUB tidak memiliki file OPF');
    const opfDir = dirname(opfPath);
    const opf = parseXml(await this.text(opfPath));

    const metadata = byTag(opf, 'metadata')[0] || opf;
    this.title = byTag(metadata, 'title')[0]?.textContent.trim() || 'Tanpa judul';
    this.author = byTag(metadata, 'creator').map((n) => n.textContent.trim()).filter(Boolean).join(', ');
    this.language = byTag(metadata, 'language')[0]?.textContent.trim() || '';
    const metas = byTag(metadata, 'meta');
    this.fixedLayout = metas.some(
      (m) => m.getAttribute('property') === 'rendition:layout' && m.textContent.trim() === 'pre-paginated',
    );

    this.manifest = new Map();
    this.byPath = new Map();
    for (const item of byTag(opf, 'item')) {
      const entry = {
        id: item.getAttribute('id'),
        path: resolvePath(opfDir, item.getAttribute('href') || ''),
        mediaType: item.getAttribute('media-type') || '',
        properties: (item.getAttribute('properties') || '').split(/\s+/),
      };
      this.manifest.set(entry.id, entry);
      this.byPath.set(entry.path, entry);
    }

    const spineEl = byTag(opf, 'spine')[0];
    this.spine = byTag(opf, 'itemref')
      .filter((ref) => ref.getAttribute('linear') !== 'no')
      .map((ref) => this.manifest.get(ref.getAttribute('idref')))
      .filter((item) => item && /html/.test(item.mediaType) && this.entry(item.path));
    if (!this.spine.length) throw new Error('EPUB tidak memiliki isi yang bisa dibaca');

    const items = [...this.manifest.values()];
    let cover = items.find((i) => i.properties.includes('cover-image'));
    if (!cover) {
      const coverId = metas.find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
      cover = coverId && this.manifest.get(coverId);
    }
    if (!cover) cover = items.find((i) => i.mediaType.startsWith('image/') && /cover/i.test(i.path));
    this.coverPath = cover?.mediaType.startsWith('image/') ? cover.path : null;

    this.toc = await this.loadToc(spineEl?.getAttribute('toc'));
  }

  async loadToc(ncxId) {
    try {
      const nav = [...this.manifest.values()].find((i) => i.properties.includes('nav'));
      if (nav) {
        const doc = new DOMParser().parseFromString(await this.text(nav.path), 'application/xhtml+xml');
        const navs = byTag(doc, 'nav');
        const tocNav =
          navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) ||
          navs[0];
        const items = [];
        const walk = (ol, level) => {
          for (const li of childrenNamed(ol, 'li')) {
            const link = childrenNamed(li, 'a')[0] || childrenNamed(li, 'span')[0];
            const href = link?.getAttribute('href');
            if (href) {
              items.push({ title: link.textContent.replace(/\s+/g, ' ').trim(), path: resolvePath(dirname(nav.path), href), level });
            }
            const sub = childrenNamed(li, 'ol')[0];
            if (sub) walk(sub, level + 1);
          }
        };
        const ol = tocNav && byTag(tocNav, 'ol')[0];
        if (ol) walk(ol, 0);
        if (items.length) return items;
      }

      const ncx =
        (ncxId && this.manifest.get(ncxId)) ||
        [...this.manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');
      if (ncx) {
        const doc = parseXml(await this.text(ncx.path));
        const items = [];
        const walk = (parent, level) => {
          for (const point of childrenNamed(parent, 'navPoint')) {
            const label = byTag(point, 'text')[0]?.textContent.trim();
            const src = byTag(point, 'content')[0]?.getAttribute('src');
            if (label && src) items.push({ title: label, path: resolvePath(dirname(ncx.path), src), level });
            walk(point, level + 1);
          }
        };
        const navMap = byTag(doc, 'navMap')[0];
        if (navMap) walk(navMap, 0);
        return items;
      }
    } catch {
      /* daftar isi rusak: buku tetap bisa dibaca */
    }
    return [];
  }
}
