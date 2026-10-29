import { useSyncExternalStore } from 'react';

/**
 * Mode fokus: sidebar dan bilah atas disembunyikan agar naskah mendapat
 * seluruh layar. Disimpan di memori (bukan per halaman) dan keluar dengan Esc.
 */
let focus = false;
const subs = new Set<() => void>();

export function setFocusMode(v: boolean) {
  if (focus === v) return;
  focus = v;
  subs.forEach((f) => f());
}

export function useFocusMode(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => focus,
  );
  return [v, setFocusMode];
}

/** Halaman yang memakai tata letak ruang kerja (lebar penuh, sidebar ikon). */
export function isWorkspacePath(pathname: string) {
  return /^\/naskah(\/|$)/.test(pathname);
}
