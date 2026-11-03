// Pengganti ringan untuk StPageFlip: pindah halaman dengan animasi geser, pudar, atau tanpa
// animasi. Hanya memakai transform/opacity (dikerjakan GPU), jadi ringan di HP.
// API-nya meniru bagian StPageFlip yang dipakai BookView: loadFromHTML, on('flip'|'changeState'),
// getCurrentPageIndex, getPageCount, getState, turnToPage, flipNext, flipPrev, destroy.

const DURATION = { slide: 280, fade: 220, none: 0 };
const EASING = 'cubic-bezier(0.22, 0.7, 0.25, 1)';
const DIRECTION_LOCK = 8; // px gerakan sebelum arah geseran ditentukan
const TAP_MOVE = 10; // px
const TAP_TIME = 350; // ms
const COMMIT_RATIO = 0.12; // geser > 12% lebar halaman -> pindah halaman
const FLICK_SPEED = 0.35; // px/ms
const QUEUE_LIMIT_MS = 4000;

export class SimpleFlip {
  constructor(el, { pageW, pageH, landscape, startPage, mode }) {
    this.el = el;
    this.pageW = pageW;
    this.pageH = pageH;
    this.landscape = landscape;
    this.step = landscape ? 2 : 1;
    this.mode = mode in DURATION ? mode : 'slide';
    this.startPage = startPage;
    this.state = 'read';
    this.listeners = {};
    this.animations = [];
    this.queued = null;
    this.gesture = null;
  }

  // ---------- API ala StPageFlip

  on(type, callback) {
    (this.listeners[type] ||= []).push(callback);
    return this;
  }

  loadFromHTML(pages) {
    this.pages = [...pages];
    this.el.classList.add('simple-book');
    for (const [i, page] of this.pages.entries()) {
      Object.assign(page.style, {
        position: 'absolute',
        top: '0',
        left: `${this.landscape && i % 2 ? this.pageW : 0}px`,
        width: `${this.pageW}px`,
        height: `${this.pageH}px`,
        display: 'none',
      });
      this.el.append(page);
    }
    this.current = this.spreadStart(this.startPage);
    this.spread(this.current).forEach((p) => (p.style.display = 'block'));
    this.attachInput();
  }

  getCurrentPageIndex() {
    return this.current;
  }

  getPageCount() {
    return this.pages.length;
  }

  getState() {
    return this.state;
  }

  turnToPage(index) {
    this.stopAnimations();
    this.spread(this.current).forEach((p) => this.resetPage(p, true));
    this.current = this.spreadStart(index);
    this.spread(this.current).forEach((p) => (p.style.display = 'block'));
    this.setState('read');
    this.emit('flip', this.current);
  }

  flipNext() {
    this.go(1);
  }

  flipPrev() {
    this.go(-1);
  }

  destroy() {
    this.stopAnimations();
    this.queued = null;
    this.el.remove();
  }

  // ---------- internal

  emit(type, data) {
    for (const callback of this.listeners[type] || []) callback({ data, object: this });
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('changeState', state);
  }

  spreadStart(index) {
    const i = Math.min(Math.max(index, 0), this.pages.length - 1);
    return this.landscape ? i - (i % 2) : i;
  }

  spread(start) {
    return this.pages.slice(start, start + this.step);
  }

  width() {
    return this.el.clientWidth || this.pageW * this.step;
  }

  resetPage(page, hide = false) {
    page.style.transform = '';
    page.style.opacity = '';
    page.style.zIndex = '';
    if (hide) page.style.display = 'none';
  }

  stopAnimations() {
    this.animations.forEach((a) => a.cancel());
    this.animations = [];
  }

  targetFor(dir) {
    const target = this.current + dir * this.step;
    return target >= 0 && target < this.pages.length ? this.spreadStart(target) : null;
  }

  go(dir) {
    if (this.state !== 'read') {
      this.queued = { dir, until: performance.now() + QUEUE_LIMIT_MS }; // diputar setelah animasi selesai
      return;
    }
    const target = this.targetFor(dir);
    if (target !== null) this.animateTo(target, dir, 0);
  }

  runQueued() {
    const queued = this.queued;
    this.queued = null;
    if (queued && performance.now() < queued.until) this.go(queued.dir);
  }

  /** Animasikan ke spread `target`. `progress` (0..1) = seberapa jauh sudah diseret jari. */
  animateTo(target, dir, progress) {
    const outgoing = this.spread(this.current);
    const incoming = this.spread(target);
    const finish = () => {
      outgoing.forEach((p) => this.resetPage(p, true));
      incoming.forEach((p) => {
        this.resetPage(p);
        p.style.display = 'block'; // mode "Tanpa" melewati animasi: tampilkan di sini
      });
      this.stopAnimations();
      this.current = target;
      this.setState('read');
      this.emit('flip', target);
      this.runQueued();
    };
    if (this.mode === 'none') {
      finish();
      return;
    }

    this.setState('flipping');
    incoming.forEach((p) => {
      p.style.display = 'block';
      p.style.zIndex = '2';
    });
    const duration = Math.max(90, DURATION[this.mode] * (1 - progress));
    const timing = { duration, easing: EASING, fill: 'forwards' };
    if (this.mode === 'slide') {
      const w = this.width();
      const offset = -dir * w * progress;
      this.animations = [
        ...outgoing.map((p) => p.animate([{ transform: `translateX(${offset}px)` }, { transform: `translateX(${-dir * w}px)` }], timing)),
        ...incoming.map((p) => p.animate([{ transform: `translateX(${offset + dir * w}px)` }, { transform: 'translateX(0)' }], timing)),
      ];
    } else {
      this.animations = incoming.map((p) => p.animate([{ opacity: progress }, { opacity: 1 }], timing));
    }
    Promise.all(this.animations.map((a) => a.finished)).then(finish, () => {});
  }

  /** Geseran dibatalkan: kembalikan spread ke posisi semula. */
  animateBack(target, dir, progress) {
    const outgoing = this.spread(this.current);
    const incoming = this.spread(target);
    const done = () => {
      incoming.forEach((p) => this.resetPage(p, true));
      outgoing.forEach((p) => this.resetPage(p));
      this.stopAnimations();
      this.setState('read');
      this.runQueued();
    };
    const w = this.width();
    const offset = -dir * w * progress;
    const timing = { duration: 200, easing: EASING, fill: 'forwards' };
    this.animations = [
      ...outgoing.map((p) => p.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], timing)),
      ...incoming.map((p) => p.animate([{ transform: `translateX(${offset + dir * w}px)` }, { transform: `translateX(${dir * w}px)` }], timing)),
    ];
    Promise.all(this.animations.map((a) => a.finished)).then(done, () => {});
  }

  // ---------- gestur: sentuh & mouse (Pointer Events)

  attachInput() {
    const el = this.el;

    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // cegah seleksi teks / drag bawaan browser: keduanya memicu pointercancel dan
      // membatalkan geseran halaman dengan mouse
      if (e.pointerType === 'mouse') e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId); // gerakan tetap terbaca walau jari keluar dari buku
      } catch {
        /* pointer sudah tidak aktif */
      }
      this.gesture = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp,
        rect: el.getBoundingClientRect(), dir: null, target: null, dragging: false, dx: 0,
        samples: [{ x: e.clientX, t: e.timeStamp }],
        busy: this.state !== 'read',
      };
    };

    const onMove = (e) => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      g.samples.push({ x: e.clientX, t: e.timeStamp });
      while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();

      if (!g.dir) {
        if (Math.hypot(dx, dy) < DIRECTION_LOCK) return;
        g.dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'none' : dx < 0 ? 1 : -1; // kiri = maju
        if (g.dir !== 'none' && this.mode === 'slide' && !g.busy) {
          g.target = this.targetFor(g.dir);
          if (g.target !== null) {
            g.dragging = true;
            this.setState('user_fold'); // BookView menyiapkan isi halaman tujuan
            this.spread(g.target).forEach((p) => {
              p.style.display = 'block';
              p.style.zIndex = '2';
            });
          }
        }
      }
      if (g.dragging) {
        const w = this.width();
        // jari mengikuti arah awal; tidak bisa ditarik melewati titik awal
        g.dx = g.dir === 1 ? Math.min(0, Math.max(-w, dx)) : Math.max(0, Math.min(w, dx));
        this.spread(this.current).forEach((p) => (p.style.transform = `translateX(${g.dx}px)`));
        this.spread(g.target).forEach((p) => (p.style.transform = `translateX(${g.dx + g.dir * w}px)`));
      }
    };

    const onUp = (e) => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.id) return;
      this.gesture = null;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;

      if (!g.dir) {
        // tap / klik: sisi kiri = mundur, sisi kanan = maju
        if (e.type === 'pointerup' && Math.hypot(dx, dy) <= TAP_MOVE && e.timeStamp - g.t0 <= TAP_TIME) {
          const x = e.clientX - g.rect.left;
          const prevZone = this.landscape ? g.rect.width / 2 : g.rect.width * 0.35;
          this.go(x < prevZone ? -1 : 1);
        }
        return;
      }
      if (g.dir === 'none') return;

      const first = g.samples[0];
      const vx = (e.clientX - first.x) / Math.max(1, e.timeStamp - first.t);
      const commit = e.type === 'pointerup'
        && (-g.dir * dx > this.pageW * COMMIT_RATIO || -g.dir * vx > FLICK_SPEED);

      if (g.dragging) {
        const progress = Math.abs(g.dx) / this.width();
        if (commit) this.animateTo(g.target, g.dir, progress);
        else this.animateBack(g.target, g.dir, progress);
      } else if (commit) {
        this.go(g.dir);
      }
    };

    el.addEventListener('dragstart', (e) => e.preventDefault()); // gambar di halaman jangan ikut terseret
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
}
