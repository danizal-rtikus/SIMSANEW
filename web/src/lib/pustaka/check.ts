/** Pemeriksaan kelengkapan pustaka terhadap naskah. */
import { cleanTitle, yearOf, type CslItem } from './csl';
import type { RefLike } from './format';

export interface PustakaStats {
  total: number;
  dikutip: number;
  terbaru: number; // terbit dalam 10 tahun terakhir
  persenTerbaru: number;
  jurnal: number;
  persenJurnal: number;
}

export interface PustakaIssue {
  kind: 'tidak-dikutip' | 'hilang' | 'tanpa-tahun' | 'tanpa-penulis' | 'duplikat' | 'lama';
  refId?: string;
  pesan: string;
}

const isJournal = (it: CslItem) => it.type === 'article-journal' || it.type === 'paper-conference';

export function checkPustaka(refs: RefLike[], citedIds: string[], tahunIni = new Date().getFullYear()): { stats: PustakaStats; issues: PustakaIssue[] } {
  const cited = new Set(citedIds);
  const ids = new Set(refs.map((r) => r.id));
  const issues: PustakaIssue[] = [];
  const hilang = [...cited].filter((id) => !ids.has(id));
  if (hilang.length) issues.push({ kind: 'hilang', pesan: `${hilang.length} sitasi di naskah merujuk pustaka yang sudah dihapus.` });

  const seen = new Map<string, string>();
  let terbaru = 0;
  let jurnal = 0;
  for (const r of refs) {
    const y = yearOf(r.csl);
    const label = cleanTitle(r.csl.title).slice(0, 70) || 'Tanpa judul';
    if (!cited.has(r.id)) issues.push({ kind: 'tidak-dikutip', refId: r.id, pesan: `Belum dikutip di naskah: "${label}".` });
    if (!y) issues.push({ kind: 'tanpa-tahun', refId: r.id, pesan: `Tahun terbit kosong: "${label}".` });
    else if (tahunIni - y <= 10) terbaru++;
    else issues.push({ kind: 'lama', refId: r.id, pesan: `Terbit lebih dari 10 tahun lalu (${y}): "${label}".` });
    if (!r.csl.author?.length) issues.push({ kind: 'tanpa-penulis', refId: r.id, pesan: `Penulis kosong: "${label}".` });
    if (isJournal(r.csl)) jurnal++;
    const key = cleanTitle(r.csl.title).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key) {
      if (seen.has(key)) issues.push({ kind: 'duplikat', refId: r.id, pesan: `Judul sama dengan rujukan lain: "${label}".` });
      else seen.set(key, r.id);
    }
  }
  const total = refs.length;
  return {
    stats: {
      total,
      dikutip: refs.filter((r) => cited.has(r.id)).length,
      terbaru,
      persenTerbaru: total ? Math.round((terbaru / total) * 100) : 0,
      jurnal,
      persenJurnal: total ? Math.round((jurnal / total) * 100) : 0,
    },
    issues,
  };
}
