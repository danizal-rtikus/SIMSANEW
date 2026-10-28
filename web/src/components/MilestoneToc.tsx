import type { ReactNode } from 'react';
import type { Milestone } from '../lib/types';
import { effectiveStatus } from '../lib/labels';
import { fmtDate, relativeDays } from '../lib/format';
import { MilestoneBadge } from './StatusBits';
import { IconCheck } from './Icons';

/**
 * Milestone ditampilkan seperti daftar isi naskah: nomor, nama tahap,
 * garis titik-titik, lalu tenggat di posisi nomor halaman.
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
  const list = compact && current ? milestones.filter((m) => Math.abs(m.urutan - current.urutan) <= 2) : milestones;

  return (
    <ol className="toc">
      {list.map((m) => {
        const s = effectiveStatus(m);
        const isCurrent = current?.id === m.id;
        const action = actions?.(m, isCurrent);
        return (
          <li key={m.id} className={`toc-item ${s} ${isCurrent ? 'current' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
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
      })}
    </ol>
  );
}
