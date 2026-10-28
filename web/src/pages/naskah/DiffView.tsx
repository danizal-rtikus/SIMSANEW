import { useMemo, useState, type ReactNode } from 'react';
import { diffChapter, diffStats, type DiffBlockInfo, type DiffEntry, type WordPart } from '../../lib/naskah/diff';
import type { PmNode } from '../../lib/naskah/struktur';

/** Tampilan Track Changes: teks dihapus dicoret merah, teks baru bergaris bawah hijau. */
export function DiffView({ oldDoc, newDoc, bab, oldLabel, newLabel }: { oldDoc: PmNode; newDoc: PmNode; bab: number; oldLabel: string; newLabel: string }) {
  const entries = useMemo(() => diffChapter(oldDoc, newDoc, bab), [oldDoc, newDoc, bab]);
  const stats = diffStats(entries);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const total = stats.berubah + stats.ditambah + stats.dihapus;

  const rows: (DiffEntry | { kind: 'gap'; n: number })[] = [];
  if (onlyChanges) {
    let gap = 0;
    entries.forEach((e, i) => {
      const near = (k: number) => entries[k] && entries[k].kind !== 'same';
      const keep = e.kind !== 'same' || (e.block.type === 'heading' && (near(i + 1) || near(i + 2)));
      if (keep) {
        if (gap) rows.push({ kind: 'gap', n: gap });
        gap = 0;
        rows.push(e);
      } else gap++;
    });
    if (gap) rows.push({ kind: 'gap', n: gap });
  } else rows.push(...entries);

  return (
    <div className="nk-diff-wrap">
      <div className="nk-diff-head">
        <div className="small">
          Membandingkan <span className="strong">{oldLabel}</span> dengan <span className="strong">{newLabel}</span>.{' '}
          {total === 0 ? 'Tidak ada perubahan isi.' : `${stats.berubah} blok berubah, ${stats.ditambah} ditambah, ${stats.dihapus} dihapus.`}
        </div>
        <label className="check small">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Hanya bagian yang berubah
        </label>
      </div>
      <div className="nk-legend small">
        <span>
          <del>dihapus</del>
        </span>
        <span>
          <ins>ditambahkan</ins>
        </span>
      </div>
      <div className="nk-paper nk-diff">
        <div className="nk-doc">
          {rows.map((r, i) =>
            r.kind === 'gap' ? (
              <div key={`g${i}`} className="nk-diff-gap">
                {r.n} blok tidak berubah
              </div>
            ) : (
              <Block key={i} e={r} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Words({ words }: { words: WordPart[] }) {
  return (
    <>
      {words.map((w, i) => (w.op === 'same' ? <span key={i}>{w.text}</span> : w.op === 'add' ? <ins key={i}>{w.text}</ins> : <del key={i}>{w.text}</del>))}
    </>
  );
}

function Shell({ b, children, cls }: { b: DiffBlockInfo; children: ReactNode; cls: string }) {
  if (b.type === 'heading') {
    const Tag = (`h${Math.min(3, b.level ?? 1)}`) as 'h1' | 'h2' | 'h3';
    return (
      <Tag className={cls} data-nomor={b.label || undefined}>
        {children}
      </Tag>
    );
  }
  if (b.lines) return <div className={`nk-diff-lines ${cls}`}>{children}</div>;
  if (b.type === 'image' || b.type === 'pageBreak') return <p className={`nk-diff-obj ${cls}`}>{children}</p>;
  return (
    <p className={cls} data-keterangan={b.label ? 'x' : undefined} data-nomor={b.label || undefined}>
      {children}
    </p>
  );
}

function Block({ e }: { e: DiffEntry }) {
  if (e.kind === 'same') return <Shell b={e.block} cls="">{e.block.text}</Shell>;
  if (e.kind === 'add')
    return (
      <Shell b={e.block} cls="nk-diff-add">
        <ins>{e.block.text}</ins>
      </Shell>
    );
  if (e.kind === 'del')
    return (
      <Shell b={e.block} cls="nk-diff-del">
        <del>{e.block.text}</del>
      </Shell>
    );
  return (
    <Shell b={e.block} cls="nk-diff-change">
      <Words words={e.words} />
    </Shell>
  );
}
