import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Prodi } from './types';

let cache: Promise<Prodi[]> | null = null;

export function loadProdi(force = false): Promise<Prodi[]> {
  if (!cache || force) {
    cache = Promise.resolve(supabase.from('prodi').select('*').order('jenjang').order('nama')).then(({ data, error }) => {
      if (error) {
        cache = null;
        throw new Error(error.message);
      }
      return (data ?? []) as Prodi[];
    });
  }
  return cache;
}

export function useProdi(): Prodi[] {
  const [list, setList] = useState<Prodi[]>([]);
  useEffect(() => {
    let alive = true;
    loadProdi()
      .then((x) => alive && setList(x))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export function prodiName(list: Prodi[], id?: string | null): string {
  const p = list.find((x) => x.id === id);
  return p ? `${p.nama} (${p.jenjang})` : '—';
}
