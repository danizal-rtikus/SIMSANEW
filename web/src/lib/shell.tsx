import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';

/* ------------------------------------------------------------------
   Penyimpanan per pengguna di browser: Terakhir dibuka, Favorit,
   sidebar diciutkan, grup menu yang terbuka. Hanya kenyamanan tampilan;
   aplikasi tetap berjalan normal bila penyimpanan tidak tersedia.
   ------------------------------------------------------------------ */
export interface PageRef {
  path: string;
  title: string;
  sub?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* penyimpanan tidak tersedia */
  }
  window.dispatchEvent(new CustomEvent('simsa:store', { detail: key }));
}

function useStored<T>(key: string | null, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (key ? read(key, fallback) : fallback));
  useEffect(() => {
    if (!key) return;
    setValue(read(key, fallback));
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === key) setValue(read(key, fallback));
    };
    window.addEventListener('simsa:store', on);
    return () => window.removeEventListener('simsa:store', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((v: T) => (key ? write(key, v) : undefined), [key]);
  return [value, set];
}

export function useRecents(): [PageRef[], (p: PageRef) => void] {
  const { userId } = useAuth();
  const key = userId ? `simsa.recents.${userId}` : null;
  const [list] = useStored<PageRef[]>(key, []);
  const add = useCallback(
    (p: PageRef) => {
      if (!key) return;
      const cur = read<PageRef[]>(key, []);
      if (cur[0]?.path === p.path && cur[0]?.title === p.title) return;
      write(key, [p, ...cur.filter((x) => x.path !== p.path)].slice(0, 6));
    },
    [key],
  );
  return [list, add];
}

export function useFavorites(): { list: PageRef[]; has: (path: string) => boolean; toggle: (p: PageRef) => void } {
  const { userId } = useAuth();
  const key = userId ? `simsa.fav.${userId}` : null;
  const [list, set] = useStored<PageRef[]>(key, []);
  return {
    list,
    has: (path) => list.some((x) => x.path === path),
    toggle: (p) => set(list.some((x) => x.path === p.path) ? list.filter((x) => x.path !== p.path) : [...list, p].slice(-10)),
  };
}

export function usePref<T>(name: string, fallback: T): [T, (v: T) => void] {
  return useStored<T>(`simsa.pref.${name}`, fallback);
}

/* ------------------------------------------------------------------
   Konteks halaman entitas (mis. satu mahasiswa): topbar menampilkan
   namanya dengan bintang favorit, sidebar berganti ke menu konteks.
   ------------------------------------------------------------------ */
export interface EntityInfo {
  kind: 'thesis';
  id: string;
  title: string;
  sub?: string;
  basePath: string;
}

const EntityCtx = createContext<{ entity: EntityInfo | null; setEntity: (e: EntityInfo | null) => void } | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [entity, setEntity] = useState<EntityInfo | null>(null);
  return <EntityCtx.Provider value={{ entity, setEntity }}>{children}</EntityCtx.Provider>;
}

export function useEntity() {
  const v = useContext(EntityCtx);
  if (!v) throw new Error('useEntity harus dipakai di dalam ShellProvider');
  return v;
}

/** Dipanggil halaman entitas setelah datanya termuat. */
export function useRegisterEntity(info: EntityInfo | null) {
  const { setEntity } = useEntity();
  const [, addRecent] = useRecents();
  const key = info ? `${info.id}|${info.title}|${info.sub ?? ''}` : '';
  useEffect(() => {
    if (!info) return;
    setEntity(info);
    addRecent({ path: info.basePath, title: info.title, sub: info.sub });
    return () => setEntity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Menyimpan halaman non-menu (mis. detail sesi) ke Terakhir dibuka. */
export function useRecordRecent(p: PageRef | null) {
  const [, addRecent] = useRecents();
  const key = p ? `${p.path}|${p.title}` : '';
  useEffect(() => {
    if (p) addRecent(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Nilai tab yang disimpan di URL (?key=...), agar menu sidebar dapat menautkan langsung ke tab. */
export function useQueryState<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(key) as T) || fallback;
  const set = useCallback(
    (v: T) => {
      const next = new URLSearchParams(params);
      if (v === fallback) next.delete(key);
      else next.set(key, v);
      setParams(next, { replace: true });
    },
    [params, setParams, key, fallback],
  );
  return [value, set];
}
