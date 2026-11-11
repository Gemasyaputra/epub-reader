// Gestur sentuh & mouse untuk membalik halaman dengan animasi lipat kertas (StPageFlip).
//
// Menggantikan penanganan bawaan StPageFlip yang terasa sulit:
// - lipatan baru mulai setelah jari ditahan 250 ms,
// - swipe hanya dikenali bila < 250 ms dan nyaris lurus (geser miring dianggap "tap"),
// - arah ditentukan dari posisi awal jari, bukan arah geseran,
// - lipatan batal kecuali jari/mouse diseret melewati punggung buku,
// - lipatan selalu dari pojok, walau ditarik dari tengah tepi halaman.
// Efek lipatan kertas tetap digambar StPageFlip (startUserTouch / userMove / userStop);
// penanganan mouse/sentuh bawaan StPageFlip dimatikan (useMouseEvents: false).

const DIRECTION_LOCK = 8; // px gerakan sebelum arah geseran ditentukan
const TAP_MOVE = 10; // px: gerakan sekecil ini dianggap tap
const TAP_TIME = 350; // ms
const COMMIT_RATIO = 0.12; // geser > 12% lebar halaman -> halaman jadi dibalik
const FLICK_SPEED = 0.35; // px/ms: kibasan cepat -> jadi dibalik walau geserannya pendek
const SETTLE_MS = 90; // waktu menggiring lipatan ke titik akhir sebelum dilepas
const QUEUE_LIMIT_MS = 4000; // swipe saat animasi masih berjalan ditunda paling lama segini (HP lambat)
const EDGE_BAND = [0.22, 0.78]; // tarikan yang dimulai di pita tengah tinggi halaman = "tarik dari tepi"
const EDGE_TILT = 0.25; // seberapa besar gerak vertikal jari memiringkan lipatan dari tepi
const EDGE_TILT_MAX = 0.12; // kemiringan maksimal (bagian dari tinggi halaman)

/** Apakah tarikan dimulai di tengah tepi halaman (bukan dekat pojok)? `y` dalam px halaman. */
export const isEdgeGrab = (y, pageH) => y > pageH * EDGE_BAND[0] && y < pageH * EDGE_BAND[1];

/**
 * Tarik dari tengah tepi halaman. StPageFlip selalu melipat dari pojok; bila titik pojok itu
 * digerakkan sejajar tepi atas/bawah, garis lipatan jadi hampir vertikal sepanjang halaman —
 * terlihat seperti kertas dibalik dari tengah tepinya. Gerak vertikal jari sedikit memiringkannya.
 */
export function edgeFoldY(startY, currentY, pageH) {
  const base = startY < pageH / 2 ? 2 : pageH - 2;
  const maxTilt = pageH * EDGE_TILT_MAX;
  const tilt = Math.max(-maxTilt, Math.min(maxTilt, (currentY - startY) * EDGE_TILT));
  return Math.min(pageH - 2, Math.max(2, base + tilt));
}

/**
 * Pasang gestur sentuh & mouse pada `stage`. Return fungsi untuk melepasnya.
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

  // ---------- logika gestur (sama untuk jari & mouse); x, y = koordinat layar

  function begin(x, y, time) {
    const flip = getFlip();
    const book = stage.querySelector('.stf__parent');
    if (!flip || !book) return false;
    const rect = book.getBoundingClientRect();
    gesture = {
      x0: x,
      y0: y,
      t0: time,
      rect,
      k: rect.width / book.offsetWidth || 1, // skala tampilan buku (mengecil saat menu tampil)
      dir: null,
      folding: false,
      point: null,
      edgeY: null,
      samples: [{ x, t: time }],
      busy: flip.getState() !== 'read', // animasi sebelumnya masih berjalan
      // titik lipatan vertikal: dari pojok mengikuti jari, dari tengah tepi tetap di dekat tepi
      foldY(py) {
        return this.edgeY !== null ? edgeFoldY(this.edgeY, py, layout.pageH) : clampY(py);
      },
    };
    return true;
  }

  function move(x, y, time) {
    const g = gesture;
    const dx = x - g.x0;
    const dy = y - g.y0;
    g.samples.push({ x, t: time });
    while (g.samples.length > 2 && time - g.samples[0].t > 100) g.samples.shift();

    if (!g.dir) {
      if (Math.hypot(dx, dy) < DIRECTION_LOCK) return;
      // arah dari geseran: kiri = halaman berikutnya, kanan = sebelumnya; geser vertikal diabaikan
      g.dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'none' : dx < 0 ? 'next' : 'prev';
      const flip = getFlip();
      if (g.dir !== 'none' && !g.busy && flip && canFlip(flip, g.dir)) {
        g.folding = true;
        const y0 = (g.y0 - g.rect.top) / g.k;
        g.edgeY = isEdgeGrab(y0, layout.pageH) ? y0 : null; // tarik dari tengah tepi, bukan pojok
        flip.startUserTouch({ x: startX[g.dir], y: g.foldY(y0) });
      }
    }
    if (g.folding) {
      g.point = { x: startX[g.dir] + dx / g.k, y: g.foldY((y - g.rect.top) / g.k) };
      getFlip()?.userMove(g.point, true);
    }
  }

  function end(x, y, time, completed) {
    const g = gesture;
    gesture = null;
    const flip = getFlip();
    if (!flip) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    const py = (y - g.rect.top) / g.k;

    if (!g.dir) {
      // tap/klik: kiri 30% = mundur, kanan 30% = maju, tengah = tampil/sembunyikan menu
      if (completed && Math.hypot(dx, dy) <= TAP_MOVE && time - g.t0 <= TAP_TIME) {
        const fx = (x - g.rect.left) / g.rect.width;
        if (fx < 0.3) flipTo('prev', py);
        else if (fx > 0.7) flipTo('next', py);
        else onCenterTap?.();
      }
      return;
    }
    if (g.dir === 'none') return;

    const first = g.samples[0];
    const vx = (x - first.x) / Math.max(1, time - first.t);
    const sign = g.dir === 'next' ? -1 : 1;
    const commit = completed && (sign * (dx / g.k) > pw * COMMIT_RATIO || sign * vx > FLICK_SPEED);

    if (g.folding && g.point) {
      settle(flip, g.point, { x: commit ? commitX[g.dir] : startX[g.dir], y: g.point.y });
    } else if (commit) {
      flipTo(g.dir, py); // tadi masih animasi: balik setelah animasi selesai
    }
  }

  // ---------- sentuhan

  function onTouchStart(e) {
    e.stopPropagation();
    if (e.touches.length > 1) {
      gesture = null; // dua jari (zoom): abaikan
      return;
    }
    const t = e.touches[0];
    if (begin(t.clientX, t.clientY, e.timeStamp)) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!gesture) return;
    e.stopPropagation();
    e.preventDefault();
    move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
  }

  function onTouchEnd(e) {
    if (!gesture) return;
    e.stopPropagation();
    e.preventDefault();
    const t = e.changedTouches[0];
    end(t.clientX, t.clientY, e.timeStamp, e.type === 'touchend');
  }

  // ---------- mouse (desktop)

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (begin(e.clientX, e.clientY, e.timeStamp)) e.preventDefault(); // cegah seleksi teks
  }

  // mousemove/mouseup didengar di window agar tarikan tetap terbaca walau mouse keluar dari buku
  function onMouseMove(e) {
    if (!gesture) return;
    e.stopPropagation();
    move(e.clientX, e.clientY, e.timeStamp);
  }

  function onMouseUp(e) {
    if (!gesture) return;
    e.stopPropagation();
    end(e.clientX, e.clientY, e.timeStamp, true);
  }

  const opts = { capture: true, passive: false };
  const listeners = [
    [stage, 'touchstart', onTouchStart],
    [stage, 'touchmove', onTouchMove],
    [stage, 'touchend', onTouchEnd],
    [stage, 'touchcancel', onTouchEnd],
    [stage, 'mousedown', onMouseDown],
    [window, 'mousemove', onMouseMove],
    [window, 'mouseup', onMouseUp],
  ];
  listeners.forEach(([target, type, fn]) => target.addEventListener(type, fn, opts));
  return () => {
    pending = null;
    gesture = null;
    listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn, opts));
  };
}
