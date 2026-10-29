import { useCallback, useId, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, roleKey } from './auth';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  /** Sedang mengambil data (termasuk pembaruan di latar saat data lama sudah tampil). */
  loading: boolean;
  reload: () => Promise<void>;
  setData: (v: T) => void;
}

/**
 * Memuat data asinkron dengan simpanan (TanStack Query).
 * Kunci simpanan dibentuk dari pengguna, peran aktif, lokasi pemanggilan,
 * isi fungsi, dan dependensi; jadi data tidak tercampur antarpengguna atau antarperan.
 * Data dibungkus { v } agar fungsi yang mengembalikan undefined tetap aman.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { key?: string } = {}): AsyncState<T> {
  const { userId, active } = useAuth();
  const site = useId();
  const client = useQueryClient();
  const queryKey = useMemo(
    () => ['async', userId ?? '-', active ? roleKey(active) : '-', opts.key ?? site, opts.key ? '' : fn.toString(), ...deps],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, active ? roleKey(active) : '-', site, opts.key, ...deps],
  );
  const q = useQuery({ queryKey, queryFn: async () => ({ v: await fn() }) });
  // Fungsi muat ulang stabil (tidak berubah tiap render) agar aman dipakai di dependensi efek.
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  const reload = useCallback(async () => {
    await refetch.current();
  }, []);
  const setData = useCallback((v: T) => client.setQueryData(queryKey, { v }), [client, queryKey]);
  const error = q.error ? (q.error as Error).message || 'Gagal memuat data' : null;
  return {
    data: q.data?.v,
    // Galat hanya ditampilkan bila tidak ada data lama yang dapat ditampilkan.
    error: q.data && q.isFetching ? null : error,
    loading: q.isFetching,
    reload,
    setData,
  };
}
