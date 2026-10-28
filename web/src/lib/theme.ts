export type Theme = 'light' | 'dark';

/** Tema dipilih pengguna (bawaan: Terang), tidak mengikuti tema sistem operasi. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem('simsa.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem('simsa.theme', t);
  } catch {
    /* penyimpanan tidak tersedia */
  }
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#18181b' : '#ffffff');
  window.dispatchEvent(new CustomEvent('simsa:theme', { detail: t }));
}
