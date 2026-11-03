// Registrasi service worker + tombol "Install aplikasi".
import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/toast.js';

let deferredPrompt = null;
export const pwaEvents = new EventTarget();

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isMobile = () =>
  isIOS() || /android/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;

// Browser bawaan aplikasi (WhatsApp, Instagram, Facebook, LINE, WebView Android) tidak bisa install PWA
const isInAppBrowser = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Telegram|; wv\)/i.test(navigator.userAgent);

/**
 * Tombol install perlu ditampilkan?
 * - Ada prompt install dari browser (Chrome/Edge/Android) -> install langsung.
 * - Di HP selalu tampil: bila prompt tidak tersedia, tombol menjelaskan penyebab & cara manualnya.
 */
export const installAvailable = () => !isStandalone() && (Boolean(deferredPrompt) || isMobile());

export function initPWA() {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast('Versi baru Lembar tersedia.', { action: 'Muat ulang', onAction: () => updateSW(true), duration: 0 });
    },
    onOfflineReady() {
      toast('Lembar siap dipakai tanpa internet.');
    },
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaEvents.dispatchEvent(new Event('change'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    pwaEvents.dispatchEvent(new Event('change'));
    toast('Lembar sudah terpasang di perangkat ini.');
  });
}

export async function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    pwaEvents.dispatchEvent(new Event('change'));
    return;
  }
  const long = { duration: 10000 };
  if (!window.isSecureContext) {
    // mis. dibuka lewat http://192.168.x.x dari HP: service worker & install diblokir browser
    toast('Install aplikasi butuh alamat HTTPS. Buka Lembar dari alamat yang sudah di-deploy (mis. Vercel), bukan alamat IP komputer.', long);
  } else if (isInAppBrowser()) {
    toast('Browser di dalam aplikasi ini tidak bisa install. Buka halaman ini di Chrome atau Safari.', long);
  } else if (isIOS()) {
    toast(/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent)
      ? 'Di iPhone/iPad, install hanya bisa lewat Safari: buka halaman ini di Safari, ketuk Bagikan, lalu "Tambahkan ke Layar Utama".'
      : 'Ketuk tombol Bagikan di Safari, lalu pilih "Tambahkan ke Layar Utama".', long);
  } else {
    toast('Buka menu ⋮ di browser, lalu pilih "Install aplikasi" atau "Tambahkan ke layar utama".', long);
  }
}
