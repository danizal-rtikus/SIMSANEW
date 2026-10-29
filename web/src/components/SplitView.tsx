import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMedia } from '../lib/useMedia';

/**
 * Daftar dan detail berdampingan di layar lebar (detail dibuka lewat ?buka=id,
 * sehingga tautannya dapat dibagikan dan tombol kembali peramban berfungsi).
 * Di layar sempit pemanggil berpindah halaman seperti biasa.
 */
export function useSplit(param = 'buka') {
  const [params, setParams] = useSearchParams();
  const wide = useMedia('(min-width: 1360px)');
  const id = wide ? params.get(param) : null;
  const open = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(param, v);
    setParams(next);
  };
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete(param);
    setParams(next);
  };
  return { wide, id, open, close };
}

export function SplitView({ open, list, detail }: { open: boolean; list: ReactNode; detail: ReactNode }) {
  return (
    <div className={`split ${open ? 'is-open' : ''}`}>
      <div className="split-list">{list}</div>
      {open && (
        <section className="split-pane" aria-label="Detail">
          {detail}
        </section>
      )}
    </div>
  );
}
