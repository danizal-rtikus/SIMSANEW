import { lazy, type ComponentType } from 'react';

/**
 * Halaman yang dimuat saat dibutuhkan (kode dipecah per halaman).
 * `preload()` dapat dipanggil lebih awal, mis. saat kursor berada di atas menu.
 */
export type LazyPage = ReturnType<typeof lazy<ComponentType<any>>> & { preload: () => Promise<unknown> };

export function lazyModule<M>(loader: () => Promise<M>) {
  let p: Promise<M> | null = null;
  const load = () => (p ??= loader().catch((e) => {
    p = null; // izinkan coba ulang bila jaringan putus
    throw e;
  }));
  return <K extends keyof M>(name: K): LazyPage => {
    const C = lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType<any> })));
    return Object.assign(C, { preload: load });
  };
}

/* Daftar awalan alamat dan pemuatnya; diisi oleh App. */
const routes: [RegExp, () => Promise<unknown>][] = [];
export function registerPreload(pattern: RegExp, load: () => Promise<unknown>) {
  routes.push([pattern, load]);
}

/** Muat kode halaman untuk alamat tertentu sebelum dibuka. */
export function preloadPath(to: string) {
  const path = to.split(/[?#]/)[0];
  for (const [re, load] of routes) {
    if (re.test(path)) {
      load().catch(() => {});
      return;
    }
  }
}

/** Muat halaman-halaman menu saat peramban senggang, setelah tampilan pertama selesai. */
export function preloadIdle(paths: string[]) {
  const run = () => paths.forEach((p) => preloadPath(p));
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
