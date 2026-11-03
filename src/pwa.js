// Registrasi service worker + tombol "Install aplikasi".
import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/toast.js';

let deferredPrompt = null;
export const pwaEvents = new EventTarget();

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Tombol install perlu ditampilkan? (Chrome/Edge/Android: prompt; iOS: petunjuk manual) */
export const installAvailable = () => !isStandalone() && (Boolean(deferredPrompt) || isIOS());

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
  } else if (isIOS()) {
    toast('Di iPhone/iPad: ketuk tombol Bagikan, lalu pilih "Tambahkan ke Layar Utama".', { duration: 8000 });
  }
}
