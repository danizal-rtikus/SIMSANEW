const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  // "YYYY-MM-DD" dianggap tanggal lokal, bukan UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const fmtDate = (v?: string | Date | null) => {
  const d = toDate(v);
  return d ? dateFmt.format(d) : '—';
};
export const fmtDateTime = (v?: string | Date | null) => {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d).replace('.', ':') : '—';
};
export const fmtDay = (v?: string | Date | null) => {
  const d = toDate(v);
  return d ? dayFmt.format(d) : '—';
};

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Selisih hari kalender dari hari ini (positif = di masa depan). */
export function daysFromToday(v?: string | null): number | null {
  const d = toDate(v);
  if (!d) return null;
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - startOfToday().getTime()) / 86400000);
}

export function relativeDays(v?: string | null): string {
  const n = daysFromToday(v);
  if (n === null) return '';
  if (n === 0) return 'hari ini';
  if (n === 1) return 'besok';
  if (n === -1) return 'kemarin';
  return n > 0 ? `${n} hari lagi` : `${-n} hari lalu`;
}

/** Nilai untuk <input type="datetime-local"> */
export function toLocalInput(v?: string | Date | null): string {
  const d = toDate(v) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toDateInput(v?: string | Date | null): string {
  return toLocalInput(v).slice(0, 10);
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(nama?: string | null): string {
  return (nama || '?')
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(dr|ir|prof)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function splitKeywords(v: string): string[] {
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
