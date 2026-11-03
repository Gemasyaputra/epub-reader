import 'page-flip/src/Style/stPageFlip.css';
import './styles.css';
import { initPWA } from './pwa.js';
import { importFiles, renderLibrary } from './ui/library.js';
import { openReader } from './ui/reader-ui.js';

const app = document.getElementById('app');
let cleanup = null;
let routeId = 0;

// Router sederhana berbasis hash: "#/" = rak buku, "#/read/<id>" = membaca
async function route() {
  const id = ++routeId;
  if (cleanup) {
    const previous = cleanup;
    cleanup = null;
    previous();
  }
  const match = location.hash.match(/^#\/read\/([^/]+)$/);
  const dispose = match ? await openReader(app, decodeURIComponent(match[1])) : await renderLibrary(app);
  if (id !== routeId) dispose?.(); // sudah pindah halaman selagi memuat
  else cleanup = dispose;
}

window.addEventListener('hashchange', route);
initPWA();

// Dibuka lewat "Buka dengan Lembar" (file .epub) pada PWA terpasang di Chrome desktop
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((handle) => handle.getFile()));
    if (await importFiles(files)) {
      if (location.hash.startsWith('#/read/')) location.hash = '#/';
      else route();
    }
  });
}

route();
