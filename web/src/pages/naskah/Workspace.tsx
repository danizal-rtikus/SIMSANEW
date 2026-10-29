import { useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { usePref } from '../../lib/shell';
import { useFocusMode } from '../../lib/workspace';
import { IconExpand, IconShrink } from '../../components/Icons';

export { useMedia } from '../../lib/useMedia';

export const SIDE_MIN = 300;
export const SIDE_MAX = 560;

/** Lebar panel kanan yang diingat per pengguna. */
export function useSideWidth(): [number, (w: number) => void] {
  const [w, setW] = usePref<number>('nkSideW', 340);
  return [Math.min(SIDE_MAX, Math.max(SIDE_MIN, Number(w) || 340)), setW];
}

/**
 * Panel kanan yang lebarnya dapat ditarik pada tepi kiri.
 * Lebar disimpan saat penarikan selesai; selama menarik hanya gaya yang berubah.
 */
export function SideDock({ width, onWidth, children, label }: { width: number; onWidth: (w: number) => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  const start = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = ref.current?.getBoundingClientRect().width ?? width;
    let w = w0;
    setDrag(true);
    const shell = ref.current?.closest<HTMLElement>('.nk-ws, .nk-review');
    const move = (ev: PointerEvent) => {
      w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, w0 + (x0 - ev.clientX)));
      shell?.style.setProperty('--side-w', `${w}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(false);
      onWidth(Math.round(w));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const key = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowLeft') onWidth(Math.min(SIDE_MAX, width + 20));
    if (e.key === 'ArrowRight') onWidth(Math.max(SIDE_MIN, width - 20));
  };

  return (
    <div className={`nk-side ${drag ? 'dragging' : ''}`} ref={ref}>
      <div
        className="nk-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Ubah lebar panel ${label}`}
        aria-valuemin={SIDE_MIN}
        aria-valuemax={SIDE_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={start}
        onKeyDown={key}
        onDoubleClick={() => onWidth(340)}
        title="Tarik untuk mengubah lebar. Klik dua kali untuk lebar bawaan."
      />
      {children}
    </div>
  );
}

export interface RailItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
  count?: number;
  hidden?: boolean;
}

/** Strip tab vertikal di tepi kanan untuk membuka atau melipat panel. */
export function Rail<K extends string>({ items, value, onChange }: { items: RailItem<K>[]; value: K | null; onChange: (k: K | null) => void }) {
  return (
    <nav className="nk-rail" aria-label="Panel samping">
      {items
        .filter((it) => !it.hidden)
        .map((it) => (
          <button
            key={it.key}
            type="button"
            className={`nk-rail-btn ${value === it.key ? 'on' : ''}`}
            aria-pressed={value === it.key}
            title={value === it.key ? `Lipat panel ${it.label}` : `Buka panel ${it.label}`}
            onClick={() => onChange(value === it.key ? null : it.key)}
          >
            {it.icon}
            <span className="nk-rail-label">{it.label}</span>
            {!!it.count && <span className="nk-rail-count">{it.count > 99 ? '99+' : it.count}</span>}
          </button>
        ))}
    </nav>
  );
}

/** Tombol mode fokus (sidebar dan bilah atas disembunyikan). */
export function FocusButton() {
  const [focus, setFocus] = useFocusMode();
  return (
    <button
      type="button"
      className={`icon-btn nk-focus-btn ${focus ? 'on' : ''}`}
      aria-pressed={focus}
      aria-label={focus ? 'Keluar dari mode fokus' : 'Mode fokus'}
      title={focus ? 'Keluar dari mode fokus (Esc)' : 'Mode fokus: sembunyikan menu dan bilah atas'}
      onClick={() => setFocus(!focus)}
    >
      {focus ? <IconShrink size={17} /> : <IconExpand size={17} />}
    </button>
  );
}

export const sideStyle = (w: number) => ({ '--side-w': `${w}px` }) as CSSProperties;
