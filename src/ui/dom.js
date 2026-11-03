export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const svg = (body, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  logo: `<svg width="28" height="28" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#8a4f2a"/><path d="M92 150c56-20 112-16 156 12v226c-44-26-100-30-156-12z" fill="#fdf6e9"/><path d="M264 162c44-28 100-32 156-12v226c-56-18-112-14-156 12z" fill="#f3e4c8"/><path d="M420 300v76c-30-10-58-14-86-12 30-14 60-36 86-64z" fill="#d9bf95"/></svg>`,
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  type: svg('<path d="M4 19l5-14 5 14M5.8 14h6.4"/><path d="M15 19l3.2-8.5L21.4 19M16 16.5h4.4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 18),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  chevronLeft: svg('<path d="M15 18l-6-6 6-6"/>', 28),
  chevronRight: svg('<path d="M9 6l6 6-6 6"/>', 28),
  bookOpen: svg('<path d="M3 5.5C6 4.5 9 4.7 12 6.5v13c-3-1.8-6-2-9-1z"/><path d="M21 5.5c-3-1-6-.8-9 1v13c3-1.8 6-2 9-1z"/>', 56),
};
