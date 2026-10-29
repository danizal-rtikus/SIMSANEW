import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------
   Menu tarik-turun sederhana (menggantikan menu bawaan browser)
   ------------------------------------------------------------------ */
export function Dropdown({ trigger, children, align = 'left', className = '' }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' | 'up'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`dd ${className}`} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`dd-menu ${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

