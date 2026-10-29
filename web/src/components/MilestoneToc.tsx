import { useMemo, useState, type ReactNode } from 'react';
import type { Milestone } from '../lib/types';
import { effectiveStatus } from '../lib/labels';
import { fmtDate, relativeDays } from '../lib/format';
import { MilestoneBadge } from './StatusBits';
import { IconCheck, IconChevronDown } from './Icons';

export interface Phase {
  nama: string;
  items: Milestone[];
  selesai: number;
  state: 'selesai' | 'berjalan' | 'nanti';
}

/** Kelompokkan milestone per fase (kolom `fase`), mempertahankan urutan. */
export function groupPhases(milestones: Milestone[]): Phase[] {
  const out: Phase[] = [];
  for (const m of milestones) {
    const nama = m.fase?.trim() || 'Tahapan';
    let g = out[out.length - 1];
    if (!g || g.nama !== nama) {
      g = { nama, items: [], selesai: 0, state: 'nanti' };
      out.push(g);
    }
    g.items.push(m);
    if (m.status === 'selesai') g.selesai++;
  }
  const cur = milestones.find((m) => m.status !== 'selesai');
  for (const g of out) {
    g.state = g.selesai === g.items.length ? 'selesai' : cur && g.items.includes(cur) ? 'berjalan' : 'nanti';
  }
  return out;
}

function Item({ m, isCurrent, actions, extra }: { m: Milestone; isCurrent: boolean; actions?: (m: Milestone, isCurrent: boolean) => ReactNode; extra?: (m: Milestone) => ReactNode }) {
  const s = effectiveStatus(m);
  const action = actions?.(m, isCurrent);
  return (
    <li className={`toc-item ${s} ${isCurrent ? 'current' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
      <span className="toc-no">{m.status === 'selesai' ? <IconCheck size={15} /> : m.urutan}</span>
      <div style={{ minWidth: 0 }}>
        <div className="toc-line">
          <span className="toc-name">{m.nama}</span>
          <span className="toc-leader" />
          <span className="toc-date">{m.status === 'selesai' ? fmtDate(m.selesai_at) : fmtDate(m.tenggat)}</span>
        </div>
        <div className="toc-meta">
          {m.status === 'selesai'
            ? m.catatan_bukti
              ? `Bukti: ${m.catatan_bukti}`
              : 'Selesai'
            : `${m.bukti}${m.tenggat ? `. Tenggat ${relativeDays(m.tenggat)}.` : ''}`}
        </div>
        {extra?.(m)}
        {action && <div className="toc-actions">{action}</div>}
      </div>
      <div className="toc-status">
        <MilestoneBadge m={m} />
      </div>
    </li>
  );
}

/** Penanda fase: setiap fase dengan jumlah tahap selesai. */
export function PhaseStepper({ phases, onPick, active }: { phases: Phase[]; onPick?: (nama: string) => void; active?: string | null }) {
  return (
    <ol className="phase-steps" aria-label="Fase studi akhir">
      {phases.map((g, i) => (
        <li key={g.nama} className={`phase-step ${g.state} ${active === g.nama ? 'on' : ''}`} aria-current={g.state === 'berjalan' ? 'step' : undefined}>
          <button type="button" onClick={() => onPick?.(g.nama)} disabled={!onPick}>
            <span className="phase-no">{g.state === 'selesai' ? <IconCheck size={13} /> : i + 1}</span>
            <span className="phase-tx">
              <span className="phase-name">{g.nama}</span>
              <span className="phase-count">
                {g.selesai}/{g.items.length} tahap
              </span>
            </span>
          </button>
          <span className="phase-bar" aria-hidden>
            <span style={{ width: `${(g.selesai / g.items.length) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Milestone dikelompokkan per fase. Fase berjalan terbuka, fase selesai dan fase
 * berikutnya terlipat (dapat dibuka). Setiap tahap tampil seperti daftar isi naskah.
 */
export function MilestoneToc({
  milestones,
  actions,
  extra,
  compact,
}: {
  milestones: Milestone[];
  actions?: (m: Milestone, isCurrent: boolean) => ReactNode;
  extra?: (m: Milestone) => ReactNode;
  compact?: boolean;
}) {
  const current = milestones.find((m) => m.status !== 'selesai');
  const phases = useMemo(() => groupPhases(milestones), [milestones]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: Phase) => open[g.nama] ?? g.state === 'berjalan';

  if (compact) {
    const g = phases.find((x) => x.state === 'berjalan') ?? phases[phases.length - 1];
    const idx = phases.indexOf(g);
    return (
      <div className="phase-compact">
        <div className="phase-compact-head">
          <span>
            Fase {idx + 1} dari {phases.length}: <strong>{g?.nama}</strong>
          </span>
          <span className="muted small">
            {g?.selesai}/{g?.items.length} tahap
          </span>
        </div>
        <ol className="toc">
          {(g?.items ?? []).map((m) => (
            <Item key={m.id} m={m} isCurrent={current?.id === m.id} />
          ))}
        </ol>
      </div>
    );
  }

  const pick = (nama: string) => {
    setOpen((o) => ({ ...o, [nama]: true }));
    requestAnimationFrame(() => document.getElementById(`fase-${slug(nama)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="phases">
      {phases.length > 1 && <PhaseStepper phases={phases} onPick={pick} />}
      {phases.map((g, i) => {
        const o = isOpen(g);
        return (
          <section key={g.nama} id={`fase-${slug(g.nama)}`} className={`phase ${g.state} ${o ? 'open' : ''}`}>
            {phases.length > 1 && (
              <button type="button" className="phase-head" aria-expanded={o} onClick={() => setOpen((x) => ({ ...x, [g.nama]: !o }))}>
                <span className="phase-head-no">Fase {i + 1}</span>
                <span className="phase-head-name">{g.nama}</span>
                <span className="phase-head-count">
                  {g.state === 'selesai' ? 'Selesai' : `${g.selesai}/${g.items.length} tahap`}
                </span>
                <IconChevronDown size={16} className="phase-chev" />
              </button>
            )}
            {(o || phases.length === 1) && (
              <ol className="toc">
                {g.items.map((m) => (
                  <Item key={m.id} m={m} isCurrent={current?.id === m.id} actions={actions} extra={extra} />
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
