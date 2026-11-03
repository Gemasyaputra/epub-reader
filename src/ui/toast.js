let timer;

/** Pesan singkat di bawah layar. `duration: 0` = tetap tampil sampai ditutup/aksi diklik. */
export function toast(message, { action, onAction, duration = 3500 } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action;
    button.addEventListener('click', () => {
      el.hidden = true;
      onAction?.();
    });
    el.append(button);
  }
  el.hidden = false;
  clearTimeout(timer);
  if (duration) timer = setTimeout(() => (el.hidden = true), duration);
}
