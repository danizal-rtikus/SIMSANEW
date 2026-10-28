import { useEffect, useState } from 'react';
import { rpc } from './queries';

export interface DosenLoad {
  dosen_id: string;
  nama: string;
  nidn: string | null;
  prodi_id: string | null;
  prodi_nama: string | null;
  bidang_keahlian: string[];
  kuota: number;
  bimbingan_aktif: number;
  sebagai_p1: number;
  sebagai_p2: number;
}

/** Daftar dosen beserta beban bimbingan (prodi tertentu, atau semua bila null). */
export function useDosenLoad(prodiId: string | null, enabled = true): { list: DosenLoad[] | null; error: string | null } {
  const [list, setList] = useState<DosenLoad[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setList(null);
    rpc<DosenLoad[]>('beban_dosen', { p_prodi: prodiId })
      .then((r) => alive && setList(r))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [prodiId, enabled]);
  return { list, error };
}

export function dosenOptionLabel(d: DosenLoad): string {
  const bidang = d.bidang_keahlian?.length ? `, ${d.bidang_keahlian.slice(0, 2).join(', ')}` : '';
  return `${d.nama} (membimbing ${d.bimbingan_aktif} dari ${d.kuota}${bidang})`;
}
