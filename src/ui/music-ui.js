// Musik pengiring per buku: panel untuk menempel link YouTube/Spotify + pemutar mini.
// Pemutar ada di luar elemen buku, jadi musik tetap jalan saat halaman dibalik atau
// tampilan disusun ulang. Iframe baru dimuat saat pengguna menekan "Putar".
import { updateBook } from '../storage.js';
import { parseMusicLink } from '../music.js';
import { ICONS, esc } from './dom.js';
import { toast } from './toast.js';

export function setupMusic({ root, bookId, initialUrl, closePanels }) {
  const panel = root.querySelector('#music-panel');
  const player = root.querySelector('#music-player');
  const frame = root.querySelector('#music-frame');
  const toggle = root.querySelector('#music-toggle');
  const title = root.querySelector('#music-title');
  const button = root.querySelector('#music-btn');

  let url = initialUrl || '';
  let info = parseMusicLink(url);

  function stop() {
    frame.replaceChildren(); // menghapus iframe = musik berhenti
    player.classList.add('collapsed');
    player.classList.remove('playing');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function sync() {
    button.classList.toggle('has-music', Boolean(info));
    player.hidden = !info;
    if (!info) return;
    const playing = frame.childElementCount > 0;
    title.textContent = playing ? info.label : `Putar musik · ${info.label}`;
  }

  function start() {
    if (!info) return;
    if (!navigator.onLine) {
      toast('Musik butuh koneksi internet.');
      return;
    }
    const iframe = document.createElement('iframe');
    // YouTube boleh langsung diputar karena dipicu ketukan pengguna
    iframe.src = info.provider === 'youtube' ? `${info.embedUrl}&autoplay=1` : info.embedUrl;
    iframe.height = String(info.height);
    iframe.title = `Pemutar musik ${info.label}`;
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube menolak embed tanpa referrer
    frame.replaceChildren(iframe);
    player.classList.remove('collapsed');
    player.classList.add('playing');
    toggle.setAttribute('aria-expanded', 'true');
    sync();
  }

  function onToggle() {
    if (!frame.childElementCount) start();
    else {
      // kecilkan / besarkan pemutar tanpa menghentikan musik
      const collapsed = player.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  async function save(newUrl) {
    url = newUrl;
    info = parseMusicLink(url);
    await updateBook(bookId, { music: info ? { url } : null });
    stop();
    sync();
  }

  function renderPanel() {
    panel.innerHTML = `
      <div class="panel-head"><h2>Musik untuk buku ini</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${ICONS.close}</button></div>
      <p class="music-help">Tempel link lagu, album, atau playlist dari <strong>YouTube</strong> atau <strong>Spotify</strong>. Musiknya diputar di pemutar kecil selama kamu membaca buku ini.</p>
      <form class="music-form" id="music-form" novalidate>
        <input type="text" inputmode="url" autocomplete="off" spellcheck="false" id="music-input"
          placeholder="https://open.spotify.com/playlist/… atau https://youtu.be/…" value="${esc(url)}" aria-label="Link YouTube atau Spotify">
        <button type="submit" class="btn btn-primary">Simpan</button>
      </form>
      <p class="music-error" id="music-error" role="alert" hidden></p>
      ${info ? `<div class="music-current"><span>Terpasang: <strong>${esc(info.label)}</strong></span><button type="button" class="btn btn-ghost" id="music-remove">Hapus musik</button></div>` : ''}
      <p class="music-note">Butuh koneksi internet. Spotify memutar lagu penuh bila kamu sudah login Spotify di browser ini; tanpa login hanya cuplikan 30 detik. Di HP, musik bisa berhenti saat layar dikunci.</p>`;
  }

  async function onPanelSubmit(e) {
    if (e.target.id !== 'music-form') return;
    e.preventDefault();
    const value = panel.querySelector('#music-input').value.trim();
    const error = panel.querySelector('#music-error');
    if (!parseMusicLink(value)) {
      error.textContent = 'Link tidak dikenali. Gunakan link lagu/album/playlist dari YouTube atau Spotify.';
      error.hidden = false;
      return;
    }
    await save(value);
    closePanels();
    start(); // ketukan "Simpan" adalah aksi pengguna: langsung putar
    toast('Musik disimpan untuk buku ini.');
  }

  async function onPanelClick(e) {
    if (e.target.closest('#music-remove')) {
      await save('');
      renderPanel();
      toast('Musik dihapus dari buku ini.');
    }
  }

  const onClose = () => {
    stop();
    sync();
  };
  toggle.addEventListener('click', onToggle);
  root.querySelector('#music-close').addEventListener('click', onClose);
  panel.addEventListener('submit', onPanelSubmit);
  panel.addEventListener('click', onPanelClick);
  sync();

  return {
    renderPanel,
    focusInput: () => panel.querySelector('#music-input')?.focus({ preventScroll: true }),
    dispose() {
      toggle.removeEventListener('click', onToggle);
      root.querySelector('#music-close').removeEventListener('click', onClose);
      panel.removeEventListener('submit', onPanelSubmit);
      panel.removeEventListener('click', onPanelClick);
      frame.replaceChildren();
    },
  };
}
