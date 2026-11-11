// Gestur sentuh (HP/tablet) untuk membalik halaman.
//
// Menggantikan penanganan sentuh bawaan StPageFlip yang terasa sulit di HP:
// - lipatan baru mulai setelah jari ditahan 250 ms,
// - swipe hanya dikenali bila < 250 ms dan nyaris lurus (geser miring dianggap "tap"),
// - arah ditentukan dari posisi awal jari, bukan arah geseran,
// - lipatan batal kecuali jari diseret sampai tepi halaman.
// Efek lipatan kertas tetap digambar StPageFlip (startUserTouch / userMove / userStop);
// mouse di desktop tetap memakai penanganan bawaan.

const DIRECTION_LOCK = 8; // px gerakan sebelum arah geseran ditentukan
const TAP_MOVE = 10; // px: gerakan sekecil ini dianggap tap
const TAP_TIME = 350; // ms
const COMMIT_RATIO = 0.12; // geser > 12% lebar halaman -> halaman jadi dibalik
const FLICK_SPEED = 0.35; // px/ms: kibasan cepat -> jadi dibalik walau geserannya pendek
const SETTLE_MS = 90; // waktu menggiring lipatan ke titik akhir sebelum dilepas
const QUEUE_LIMIT_MS = 4000; // swipe saat animasi masih berjalan ditunda paling lama segini (HP lambat)

/**
 * Pasang gestur sentuh pada `stage`. Return fungsi untuk melepasnya.
 * `layout` = hasil computeLayout(): pageW, pageH, landscape.
 */
export function attachTouch(stage, getFlip, layout, { onCenterTap } = {}) {
  const pw = layout.pageW;
  // Koordinat relatif elemen buku. Punggung buku: tepi kiri halaman (1 halaman) / tengah (2 halaman).
  // StPageFlip menganggap halaman jadi dibalik bila titik lipatan melewati punggung buku.
  const spineX = layout.landscape ? pw : 0;
  const startX = { next: spineX + pw - 2, prev: spineX - pw + 2 };
  const commitX = { next: spineX - 30, prev: spineX + 30 };
  const clampY = (y) => Math.min(layout.pageH - 2, Math.max(2, y));

  let gesture = null;
  let pending = null;

  const canFlip = (flip, dir) =>
    dir === 'next' ? flip.getCurrentPageIndex() < flip.getPageCount() - 1 : flip.getCurrentPageIndex() >= 1;

  function runPending() {
    if (!pending) return;
    const flip = getFlip();
    if (!flip || performance.now() > pending.until) {
      pending = null;
    } else if (flip.getState() === 'read') {
      const { go } = pending;
      pending = null;
      go(flip);
    } else {
      setTimeout(runPending, 40);
    }
  }

  // Balik halaman dengan animasi penuh; bila animasi sebelumnya belum selesai, antrekan.
  function flipTo(dir, y) {
    const corner = y < layout.pageH / 2 ? 'top' : 'bottom';
    const go = (flip) => (dir === 'next' ? flip.flipNext(corner) : flip.flipPrev(corner));
    const flip = getFlip();
    if (!flip) return;
    if (flip.getState() === 'read') go(flip);
    else {
      pending = { go, until: performance.now() + QUEUE_LIMIT_MS };
      runPending();
    }
  }

  // Giring lipatan ke titik akhir lalu lepas: StPageFlip menyelesaikan atau membatalkan balikan.
  function settle(flip, from, to) {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / SETTLE_MS);
      const ease = 1 - (1 - k) ** 2;
      const point = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
      flip.userMove(point, true);
      if (k < 1) requestAnimationFrame(step);
      else flip.userStop(point);
    };
    requestAnimationFrame(step);
  }

  function onStart(e) {
    e.stopPropagation(); // jangan diteruskan ke penanganan sentuh bawaan StPageFlip
    if (e.touches.length > 1) {
      gesture = null; // dua jari (zoom): abaikan
      return;
    }
    const flip = getFlip();
    const book = stage.querySelector('.stf__parent');
    if (!flip || !book) return;
    e.preventDefault();
    const t = e.touches[0];
    gesture = {
      x0: t.clientX,
      y0: t.clientY,
      t0: e.timeStamp,
      rect: book.getBoundingClientRect(),
      // skala tampilan buku (mengecil saat menu tampil): px layar -> px halaman
      k: book.getBoundingClientRect().width / book.offsetWidth || 1,
      dir: null,
      folding: false,
      point: null,
      samples: [{ x: t.clientX, t: e.timeStamp }],
      busy: flip.getState() !== 'read', // animasi sebelumnya masih berjalan
    };
  }

  function onMove(e) {
    if (!gesture) return;
    e.stopPropagation();
    e.preventDefault();
    const g = gesture;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    g.samples.push({ x: t.clientX, t: e.timeStamp });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();

    if (!g.dir) {
      if (Math.hypot(dx, dy) < DIRECTION_LOCK) return;
      // arah dari geseran: kiri = halaman berikutnya, kanan = sebelumnya; geser vertikal diabaikan
      g.dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'none' : dx < 0 ? 'next' : 'prev';
      const flip = getFlip();
      if (g.dir !== 'none' && !g.busy && flip && canFlip(flip, g.dir)) {
        g.folding = true;
        flip.startUserTouch({ x: startX[g.dir], y: clampY((g.y0 - g.rect.top) / g.k) });
      }
    }
    if (g.folding) {
      g.point = { x: startX[g.dir] + dx / g.k, y: clampY((t.clientY - g.rect.top) / g.k) };
      getFlip()?.userMove(g.point, true);
    }
  }

  function onEnd(e) {
    if (!gesture) return;
    e.stopPropagation();
    e.preventDefault();
    const g = gesture;
    gesture = null;
    const flip = getFlip();
    if (!flip) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    const y = (t.clientY - g.rect.top) / g.k;

    if (!g.dir) {
      // tap: kiri 30% = mundur, kanan 30% = maju, tengah = tampil/sembunyikan menu
      if (e.type === 'touchend' && Math.hypot(dx, dy) <= TAP_MOVE && e.timeStamp - g.t0 <= TAP_TIME) {
        const x = (t.clientX - g.rect.left) / g.rect.width;
        if (x < 0.3) flipTo('prev', y);
        else if (x > 0.7) flipTo('next', y);
        else onCenterTap?.();
      }
      return;
    }
    if (g.dir === 'none') return;

    const first = g.samples[0];
    const vx = (t.clientX - first.x) / Math.max(1, e.timeStamp - first.t);
    const sign = g.dir === 'next' ? -1 : 1;
    const commit = e.type === 'touchend' && (sign * (dx / g.k) > pw * COMMIT_RATIO || sign * vx > FLICK_SPEED);

    if (g.folding && g.point) {
      settle(flip, g.point, { x: commit ? commitX[g.dir] : startX[g.dir], y: g.point.y });
    } else if (commit) {
      flipTo(g.dir, y); // tadi masih animasi: balik setelah animasi selesai
    }
  }

  const opts = { capture: true, passive: false };
  stage.addEventListener('touchstart', onStart, opts);
  stage.addEventListener('touchmove', onMove, opts);
  stage.addEventListener('touchend', onEnd, opts);
  stage.addEventListener('touchcancel', onEnd, opts);
  return () => {
    pending = null;
    stage.removeEventListener('touchstart', onStart, opts);
    stage.removeEventListener('touchmove', onMove, opts);
    stage.removeEventListener('touchend', onEnd, opts);
    stage.removeEventListener('touchcancel', onEnd, opts);
  };
}
