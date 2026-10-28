import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, roleKey } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { HOME, flatten, type NavSection } from '../lib/navigation';
import { useFavorites, useRecents } from '../lib/shell';
import { ROLE_LABEL } from '../lib/labels';
import { applyTheme, readTheme } from '../lib/theme';
import type { Prodi } from '../lib/types';
import { IconClock, IconSearch, IconStar, IconUsers, IconChevronRight } from './Icons';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, sections, prodi, initialQuery = '' }: { open: boolean; onClose: () => void; sections: NavSection[]; prodi: Prodi[]; initialQuery?: string }) {
  const navigate = useNavigate();
  const { roles, setActive, active } = useAuth();
  const [recents] = useRecents();
  const fav = useFavorites();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [students, setStudents] = useState<{ thesis_id: string; mahasiswa_nama: string; nim: string | null; prodi_kode: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const staff = active && active.role !== 'mahasiswa';

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialQuery]);

  // Cari mahasiswa (hanya data yang boleh dilihat peran ini, dijaga RLS)
  useEffect(() => {
    if (!open || !staff || q.trim().length < 2) {
      setStudents([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const s = q.trim().replace(/[%,()]/g, ' ');
      const { data } = await supabase
        .from('v_thesis_progress')
        .select('thesis_id, mahasiswa_nama, nim, prodi_kode')
        .or(`mahasiswa_nama.ilike.%${s}%,nim.ilike.%${s}%,judul.ilike.%${s}%`)
        .limit(6);
      if (alive) setStudents((data as typeof students) ?? []);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, staff]);

  const go = (to: string) => () => {
    navigate(to);
    onClose();
  };

  const entries = useMemo<Entry[]>(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
    const out: Entry[] = [];
    students.forEach((s) =>
      out.push({ id: `m-${s.thesis_id}`, label: s.mahasiswa_nama, hint: `${s.nim ?? ''} ${s.prodi_kode}`.trim(), group: 'Mahasiswa', run: go(`/mahasiswa-bimbingan/${s.thesis_id}`) }),
    );
    fav.list.filter((f) => hit(`${f.title} ${f.sub ?? ''}`)).forEach((f) => out.push({ id: `f-${f.path}`, label: f.title, hint: f.sub, group: 'Favorit', run: go(f.path) }));
    if (!needle) recents.forEach((r) => out.push({ id: `r-${r.path}`, label: r.title, hint: r.sub, group: 'Terakhir dibuka', run: go(r.path) }));
    [{ to: HOME.to, label: HOME.label }, ...flatten(sections), { to: '/notifikasi', label: 'Notifikasi' }, { to: '/profil', label: 'Profil dan kata sandi' }]
      .filter((n) => hit(`${n.label} ${'group' in n ? n.group ?? '' : ''}`))
      .forEach((n) => out.push({ id: `n-${n.to}`, label: n.label, hint: 'group' in n ? (n as { group?: string }).group : undefined, group: 'Menu', run: go(n.to) }));
    roles
      .filter((r) => active && roleKey(r) !== roleKey(active))
      .forEach((r) => {
        const kode = prodi.find((p) => p.id === r.prodi_id)?.kode;
        const label = `Masuk sebagai ${ROLE_LABEL[r.role]}${kode ? ` ${kode}` : ''}`;
        if (hit(label)) out.push({ id: `role-${roleKey(r)}`, label, group: 'Peran', run: () => { setActive(r); navigate('/'); onClose(); } });
      });
    const dark = readTheme() === 'dark';
    const themeLabel = dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
    if (hit(`${themeLabel} tema terang gelap`)) out.push({ id: 'theme', label: themeLabel, group: 'Tampilan', run: () => { applyTheme(dark ? 'light' : 'dark'); onClose(); } });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, students, recents, fav.list, sections, roles, active, prodi]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(entries.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      entries[sel]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = '';
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Pencarian cepat" onKeyDown={onKey}>
        <div className="palette-input">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={staff ? 'Cari menu, halaman, atau nama/NIM mahasiswa' : 'Cari menu atau halaman'}
            aria-label="Kata kunci"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {entries.length === 0 && <div className="palette-empty">Tidak ada yang cocok dengan "{q}".</div>}
          {entries.map((e, i) => {
            const head = e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            return (
              <div key={e.id}>
                {head && <div className="palette-group">{head}</div>}
                <button
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className={`palette-item ${i === sel ? 'sel' : ''}`}
                  onMouseMove={() => setSel(i)}
                  onClick={e.run}
                >
                  <span className="palette-icon">
                    {e.group === 'Mahasiswa' ? <IconUsers size={16} /> : e.group === 'Terakhir dibuka' ? <IconClock size={16} /> : e.group === 'Favorit' ? <IconStar size={16} /> : <IconChevronRight size={16} />}
                  </span>
                  <span className="palette-label">{e.label}</span>
                  {e.hint && <span className="palette-hint">{e.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> pilih</span>
          <span><kbd>Enter</kbd> buka</span>
        </div>
      </div>
    </div>
  );
}
