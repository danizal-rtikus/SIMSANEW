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

export type Density = 'nyaman' | 'rapat';

export function readDensity(): Density {
  try {
    return localStorage.getItem('simsa.density') === 'rapat' ? 'rapat' : 'nyaman';
  } catch {
    return 'nyaman';
  }
}

/** Kerapatan tampilan: "rapat" memperkecil jarak tabel dan menu untuk pengelola banyak data. */
export function applyDensity(d: Density) {
  try {
    localStorage.setItem('simsa.density', d);
  } catch {
    /* penyimpanan tidak tersedia */
  }
  if (d === 'rapat') document.documentElement.setAttribute('data-density', 'rapat');
  else document.documentElement.removeAttribute('data-density');
}
